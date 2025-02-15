import express, { Request, Response } from "express";
import axios from "axios";
import path from "path";
import dotenv from "dotenv";
import { addMovieToRadarr, addTagForMovie, checkMovieInRadarr, getMovieStatus, getTagId, isMovieDownloading, searchMovieInRadarr } from "./systems/radarr";
import { config } from "./config";
import { notifyPlexFolderRefresh, updatePlexDescription } from "./systems/plex";
import { cleanUpDummyFile, createDummyFile, createSymlink, ensureDirectoryExists, removeDummyFolder } from "./utils";
import { terminateStreamByFile } from "./systems/tautulli";
import { getEpisodesBySeriesId, groupEpisodesBySeason, searchSeriesInSonarr, getSeriesByTvdbId, monitorAllSeasons, monitorSeries } from "./systems/sonarr";
import { getMetas } from "./systems/justwatch";

const app = express();
const PORT = 3000;

dotenv.config();

app.use(express.json());



// Function to check season availability every 5 seconds
async function monitorSeasonAvailability(
    seriesId: number,
    seasonNumber: number,
    ratingKey: string,
    seasonDescription: string
) {
    console.log(`🔵 Monitoring availability for Season ${seasonNumber} of Series ID ${seriesId} for the next 5 minutes...`);

    const maxRetries = 60;
    let attempts = 0;

    return new Promise<void>((resolve) => {
        const interval = setInterval(async () => {
            attempts++;

            let requestStatus = `Checking availability for Season ${seasonNumber} (attempt ${attempts}/${maxRetries})...`;

            console.log(`🟡 ${requestStatus}`);

            try {
                // Get episodes for the specified season from Sonarr
                const episodes = await getEpisodesBySeriesId(seriesId, seasonNumber);

                // Filter episodes to check for availability
                const unavailableEpisodes = episodes.filter(
                    (ep: any) => !ep.hasFile || (ep.episodeFile && ep.episodeFile.relativePath === "dummy.mp4")
                );

                if (unavailableEpisodes.length === 0) {
                    console.log(`🎉 All episodes for Season ${seasonNumber} of Series ID ${seriesId} are now available!`);

                    clearInterval(interval);
                    resolve();
                } else {
                    requestStatus = `Waiting for ${unavailableEpisodes.length} episodes to be available in Season ${seasonNumber}...`;

                    // Update the season description with the current status
                    await updatePlexDescription(ratingKey, seasonDescription, requestStatus);
                }
            } catch (error: any) {
                console.error(`❌ Error checking availability for Season ${seasonNumber}:`, error.message);
            }

            if (attempts >= maxRetries) {
                console.log(`⏰ Time limit exceeded. Not all episodes in Season ${seasonNumber} are available yet.`);

                // Update the season description with a timeout message
                await updatePlexDescription(
                    ratingKey,
                    seasonDescription,
                    `Time limit exceeded. Not all episodes in Season ${seasonNumber} are available yet. Please try again.`
                );

                clearInterval(interval);
                resolve();
            }
        }, 5000); // Check every 5 seconds
    });
}



// Function to check movie status every 5 seconds
async function monitorAvailability(movieId: number, ratingKey: string, originalFilePath: string, movieDescription: string) {
    console.log("🔵 Monitoring availability for ID " + movieId + " the next 5 minutes...");

    const maxRetries = 60;
    let attempts = 0;

    return new Promise<void>((resolve) => {
        const interval = setInterval(async () => {
            attempts++;

            let requestStatus = `Checking availability for movie (attempt ${attempts}/${maxRetries})...`;

            console.log(`🟡 Checking availability (attempt ${attempts}/${maxRetries})...`);

            const movie = await getMovieStatus(movieId);

            const downloading = await isMovieDownloading(movieId);

            if (downloading) {
                console.log(`⏳ Movie ID ${movieId} is currently downloading. Waiting for completion...`);
                requestStatus = `Movie is currently downloading. Waiting for completion...`;
            }

            // await checkFailedSearches(movieId); // Check for failed searches TEST

            if (movie) {
                // Check if the file is a dummy
                if (movie.movieFile && movie.movieFile.relativePath === "dummy.mp4") {
                    console.log("❌ Dummy file detected, ignoring availability and continuing search.");
                    //await searchMovieInRadarr(movieId); // Force a search
                } else if (movie.hasFile) {
                    console.log(`🎉 Movie "${movie.title}" is now available!`);

                    // Terminate the stream for the file
                    if (originalFilePath) {
                        await terminateStreamByFile(originalFilePath);
                    }

                    clearInterval(interval);
                    resolve();
                } else {
                    await updatePlexDescription(ratingKey, movieDescription, requestStatus);
                }
            }

            if (attempts >= maxRetries) {
                console.log("⏰ Time limit exceeded. The movie is not available yet.");

                // Determine if a torrent has been downloaded; is the movie actually available? We might know this sooner.

                clearInterval(interval);
                resolve();
            }
        }, 5000); // Check every 5 seconds
    });
}

const activeRequests = new Set<string>(); // Track active movie requests

// Route for the Tautulli webhook
app.post("/webhook", async (req: Request, res: Response, next: express.NextFunction): Promise<void> => {
    try {
        const event = req.body;

        console.log("📩 Event received:", event);

        // Check if it is a playback.start event
        if (event && event.event === "playback.start") {
            console.log("▶️ Playback started!");
            console.log("📋 Event details:", JSON.stringify(event, null, 2));

            if (event.media_type === "movie") {
                const tmdbId = event.tmdb_id;
                const ratingKey = event.rating_key;

                if (!ratingKey) {
                    console.log("⚠️ No ratingKey received in the request.");
                    res.status(400).send("Invalid request: missing ratingKey.");
                }

                // Check if there is already a request for this ratingKey
                if (activeRequests.has(ratingKey)) {
                    console.log(`🔁 Request for movie with ratingKey ${ratingKey} is already active.`);
                    res.status(200).send("Request already in progress.");
                }

                // Add ratingKey to the set
                activeRequests.add(ratingKey);

                try {
                    if (tmdbId) {
                        console.log(`🎬 TMDb ID received: ${tmdbId}`);

                        // Retrieve movie details from Radarr
                        const response = await axios.get(`${config.RADARR_URL}/movie?tmdbId=${tmdbId}`, {
                            headers: { "X-Api-Key": config.RADARR_API_KEY },
                        });

                        const movies = response.data;

                        if (movies && movies.length > 0) {
                            const movie = movies[0]; // only and first object
                            if (movie) {
                                console.log("✅ Movie found in Radarr:");
                                console.log(JSON.stringify(movie, null, 2));

                                const originalFilePath = event.file;

                                // Check availability
                                if (!movie.hasFile || (movie.movieFile && movie.movieFile.relativePath === "dummy.mp4")) {
                                    console.log("❌ Dummy file detected or movie not available. Initiating search...");
                                    const movieDescription = movie.overview;

                                    let requestStatus = "The movie is being requested. Please wait a few moments while it becomes available.";
                                    updatePlexDescription(ratingKey, movieDescription, requestStatus);

                                    searchMovieInRadarr(movie.id, config.RADARR_URL, config.RADARR_API_KEY);
                                    console.log("Movie ID:", movie.id)
                                    // Start monitoring for availability
                                    await monitorAvailability(movie.id, ratingKey, originalFilePath, movieDescription);
                                } else {
                                    console.log(`🎉 Movie "${movie.title}" is already available!`);
                                }
                            } else {
                                console.log("❌ No movie found in Radarr with the given TMDb ID.");
                            }
                        } else {
                            console.log("❌ Movie not found in Radarr.");
                        }
                    } else {
                        console.log("⚠️ No IMDb ID received in the request.");
                    }
                } catch (error: any) {
                    console.error(`❌ Error processing the request: ${error.message}`);
                } finally {
                    // Remove ratingKey from the set after completion
                    activeRequests.delete(ratingKey);
                    console.log(`✅ Request for movie with ratingKey ${ratingKey} completed.`);
                }
            } else if (
                event.media_type === "show" ||
                event.media_type === "season" ||
                event.media_type === "episode"
            ) {
                const filePath = event.file;
                const ratingKey = event.rating_key;
                const seasonNumber = event.season_num;
                const tvdbId = event.thetvdb_id; // Tautulli provides thetvdb_id

                if (!filePath || !ratingKey || !tvdbId) {
                    console.log("⚠️ Missing file path, ratingKey, or tvdbId in the request.");
                    res.status(400).send("Invalid request: missing required parameters.");
                    return;
                }

                if (!filePath.endsWith("(dummy).mp4")) {
                    console.log("ℹ️ This is not a dummy file playback. Ignoring.");
                    res.status(200).send("Not a dummy file playback.");
                    return;
                }

                if (activeRequests.has(ratingKey)) {
                    console.log(`🔁 Request for series with ratingKey ${ratingKey} is already active.`);
                    res.status(200).send("Request already in progress.");
                    return;
                }

                activeRequests.add(ratingKey);

                try {
                    console.log(`📺 Series playback detected with TVDB ID: ${tvdbId}`);

                    // Get series information from Sonarr using tvdbId
                    const series = await getSeriesByTvdbId(tvdbId, config.SONARR_URL, config.SONARR_API_KEY);

                    if (!series) {
                        console.log(`❌ No series found in Sonarr for TVDB ID: ${tvdbId}`);
                        res.status(404).send("Series not found in Sonarr.");
                        return;
                    }

                    console.log(`✅ Found series in Sonarr: ${series.title}`);

                    // To-do; don't monitor the specials! (season 0)
                    // Current code doesn't work and still monitors the specials. 
                    await monitorAllSeasons(series.id, config.SONARR_URL, config.SONARR_API_KEY);

                    console.log(`🔍 Searching for season ${seasonNumber} in Sonarr...`);
                    await searchSeriesInSonarr(series.id, seasonNumber, config.SONARR_URL, config.SONARR_API_KEY);

                    // To-do; make monitoring all seasons optional!
                    console.log("🔄 Monitoring the entire series in Sonarr...");
                    // Eerst de aflevering die gevraagd wordt; deze wil de gebruiker afspelen en ook de status voor terugkrijgen. Scheelt weer wat seconden voor de gebruiker.
                    await monitorSeasonAvailability(series.id, seasonNumber, ratingKey, "Checking availability for Season...");


                    // To-do; make this optional!
                    console.log("🔍 Searching for the rest of the seasons in Sonarr...");
                    await searchSeriesInSonarr(series.id, null, config.SONARR_URL, config.SONARR_API_KEY);


                } catch (error: any) {
                    console.error(`❌ Error processing the series request: ${error.message}`);
                } finally {
                    activeRequests.delete(ratingKey);
                    console.log(`✅ Request for series with ratingKey ${ratingKey} completed.`);
                }
            }
        } else {
            console.log("⚠️ Received event is not playback.start:", event.event);
        }

        res.status(200).send("Webhook received.");
    } catch (error) {
        console.error("❌ Error processing the webhook:", error);
        res.status(500).send("Internal Server Error");
    }
});





























app.post("/sonarr-webhook", async (req: Request, res: Response) => {
    const event = req.body;

    console.log("📩 Sonarr Webhook received:", event);

    if (event && event.eventType === "SeriesAdd" && event.series) {
        const series = event.series;
        const seriesId = series.id;
        const seriesTitle = series.title;
        const seriesPath = series.path;
        const dummySeriesFolder = path.join(config.SERIES_FOLDER_DUMMY, path.basename(seriesPath));
        const sonarrTag = config.SONARR_MONITOR_TAG_NAME;

        try {
            // Check if the series contains the required tag
            if (!series.tags.includes(sonarrTag)) {
                console.log(`❌ Series "${seriesTitle}" does not contain the required tag "${sonarrTag}".`);
                res.status(200).send("Series does not contain required tag.");
            }

            console.log(`🎬 New series added with tag "${sonarrTag}": ${seriesTitle}`);

            // Ensure the series folder exists in both locations
            await ensureDirectoryExists(dummySeriesFolder);
            await ensureDirectoryExists(seriesPath);

            // Get all episodes for the series
            const episodes = await getEpisodesBySeriesId(seriesId);

            // Group episodes by season
            const episodesBySeason = groupEpisodesBySeason(episodes);

            // Loop through seasons and create dummy files for released seasons
            for (const [seasonNumber, seasonEpisodes] of Object.entries(episodesBySeason)) {
                if (seasonNumber === "0") {
                    console.log(`⏭️ Skipping specials (Season 0) for "${seriesTitle}".`);
                    continue; // Skip specials
                }

                const releasedEpisodes = seasonEpisodes.filter(
                    (episode: any) => new Date(episode.airDate) <= new Date()
                );

                if (releasedEpisodes.length > 0) {
                    console.log(`📁 Creating dummy file for Season ${seasonNumber} of "${seriesTitle}".`);

                    // Construct paths for season folders
                    const dummySeasonFolder = path.join(dummySeriesFolder, `Season ${seasonNumber}`);
                    const plexSeasonFolder = path.join(seriesPath, `Season ${seasonNumber}`);

                    // Ensure season folders exist
                    await ensureDirectoryExists(dummySeasonFolder);
                    await ensureDirectoryExists(plexSeasonFolder);

                    // Create dummy file path
                    // https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/ (Multiple Episodes in a Single File)
                    const dummyFileName = `${seriesTitle} – s${String(seasonNumber).padStart(2, "0")}e01-e${String(
                        releasedEpisodes.length
                    ).padStart(2, "0")} (dummy).mp4`; // To-do: where to add dummy tag in file name? Plex wants the serie name in the file.

                    const dummyFilePath = path.join(dummySeasonFolder, dummyFileName);
                    const plexLinkPath = path.join(plexSeasonFolder, dummyFileName);

                    // Create dummy file
                    await createDummyFile(config.DUMMY_FILE_LOCATION, dummyFilePath);

                    // Create symlink in Plex folder
                    await createSymlink(dummyFilePath, plexLinkPath);

                    console.log(`✅ Dummy file and symlink created for Season ${seasonNumber} of "${seriesTitle}".`);
                } else {
                    console.log(`⏳ Season ${seasonNumber} of "${seriesTitle}" has no released episodes yet.`);
                }
            }

            // Refresh Plex library for the new series folder
            const seriesFolderName = path.basename(seriesPath); // Get series folder name
            const seriesFolder = path.join(config.PLEX_SERIES_FOLDER, seriesFolderName); // Plex series path
            await notifyPlexFolderRefresh(seriesFolder, config.PLEX_SERIES_LIBRARY_ID);

            res.status(200).send("Series processed and dummy files created.");
        } catch (error: any) {
            console.error(`❌ Error processing series "${seriesTitle}":`, error.message);
            res.status(500).send("Error processing series.");
        }
    } else if (event.eventType === "Download" && event.series && event.episodes && event.episodeFile) {
        const series = event.series;
        const episode = event.episodes[0];
        const episodeFile = event.episodeFile;

        const seasonNumber = episode.seasonNumber;
        const seriesFolder = series.path;
        const dummySeasonFolder = path.join(
            config.SERIES_FOLDER_DUMMY,
            path.basename(seriesFolder),
            `Season ${seasonNumber}`
        );

        console.log(
            `🎬 File imported for series: ${series.title} (ID: ${series.id}, Season: ${seasonNumber}, Episode: ${episode.episodeNumber}).`
        );

        console.log(`📁 Dummy folder for cleanup: ${dummySeasonFolder}`);

        // Cleanup the dummy file for the season
        await cleanUpDummyFile(dummySeasonFolder);

        // Remove the dummy folder for the season if it exists
        await removeDummyFolder(dummySeasonFolder);

        // Notify Plex to refresh the series folder
        await notifyPlexFolderRefresh(seriesFolder, config.PLEX_SERIES_LIBRARY_ID);

        console.log(`✅ Successfully processed import for series: ${series.title}, Season: ${seasonNumber}, Episode: ${episode.episodeNumber}.`);

        res.status(200).send("Sonarr Download event processed successfully.");

    } else {
        console.log("⚠️ No valid Sonarr event received.");
        res.status(200).send("Invalid Sonarr event.");
    }
});
































app.post("/radarr-webhook", async (req: Request, res: Response) => {
    const event = req.body;

    console.log("📩 Radarr Webhook received:", event);

    // Check if it is an event for a new movie
    if (event && event.eventType === "MovieAdded" && event.movie && event.movie.folderPath) {
        let movieFolder = event.movie.folderPath;
        const movieFolderDummy = path.join(config.MOVIE_FOLDER_DUMMY, path.basename(movieFolder));
        const movieFolderPlex = path.join(config.PLEX_MOVIE_FOLDER, path.basename(movieFolder));

        const dummySource = config.DUMMY_FILE_LOCATION; // Path to the dummy file
        const dummyLink = path.join(movieFolderDummy, "dummy.mp4"); // Symlink target

        const plexLink = path.join(movieFolderPlex, "dummy.mp4"); // Symlink target

        const radarrTag = config.RADARR_MONITOR_TAG_NAME;

        if (event.movie.tags.includes(radarrTag)) {

            console.log(`🎬 New movie added with ${radarrTag} tag. Folder: ${movieFolderDummy}`);

            try {
                // Ensure the directory exists
                await ensureDirectoryExists(movieFolderDummy);
                await ensureDirectoryExists(movieFolder);

                // Create dummy file
                await createDummyFile(dummySource, dummyLink);

                // Create the symlink
                await createSymlink(dummyLink, plexLink);

                movieFolder = path.join(config.PLEX_MOVIE_FOLDER, path.basename(movieFolder)); // Temporary because my Plex has a different path
                await notifyPlexFolderRefresh(movieFolder, config.PLEX_MOVIES_LIBRARY_ID);

                res.status(200).send("Symlink created and Plex folder notified successfully.");
            } catch (error) {
                res.status(500).send("Error while processing the webhook.");
            }
        } else {
            const receivedTags = event.movie.tags.join(", ");
            console.log(`❌ Movie "${event.movie.title}" does not contain the required tag "${radarrTag}". Received tags: [${receivedTags}]`);
        }
    } else if (event && event.eventType === "Download" && event.movie && event.movie.folderPath) {
        console.log(event);
        let movieFolder = event.movie.folderPath;
        const imdbId = event.movie.imdbId;
        const tmdbId = event.movie.tmdbId;

        const movieFolderDummy = path.join(config.MOVIE_FOLDER_DUMMY, path.basename(movieFolder));

        console.log(`🎬 File imported for movie: ${event.movie.title} (${event.movie.year}). Folder: ${movieFolder}`);

        // Call the function to clean up dummy.mp4
        await cleanUpDummyFile(movieFolder);
        await removeDummyFolder(movieFolderDummy);

        // Add movie to 4K Radarr instance if configured
        if (config.RADARR_4K_URL) {
            (async () => {
                try {
                    const [exists, movieDetails] = await checkMovieInRadarr(tmdbId, config.RADARR_4K_URL!, config.RADARR_4K_API_KEY!);

                    if (exists) {
                        if (!movieDetails.hasFile || (movieDetails.movieFile && movieDetails.movieFile.relativePath === "dummy.mp4")) {
                            // Movie not available in 4K instance yet
                            await searchMovieInRadarr(movieDetails.id, config.RADARR_4K_URL!, config.RADARR_4K_API_KEY!);
                        }

                        console.log(`✅ Movie already exists in Radarr: ${movieDetails.title}`);
                    } else {
                        console.log(`❌ Movie not found in Radarr. Adding...`);

                        // Add the movie with default parameters
                        const newMovie = await addMovieToRadarr(tmdbId, config.RADARR_4K_MOVIE_FOLDER!,
                            Number(config.RADARR_4K_QUALITY_PROFILE_ID), true, true, config.RADARR_4K_URL!, config.RADARR_4K_API_KEY!, ["infiniteplexlibrary"]);

                        console.log(`🎥 Movie added to Radarr 4K: ${newMovie.title}`);
                    }
                } catch (error: any) {
                    console.error(`❌ Error processing the movie: ${error.message}`);
                }
            })();
        }

        // Notify Plex folder refresh
        movieFolder = path.join(config.PLEX_MOVIE_FOLDER, path.basename(movieFolder)); // Temporary because my Plex has a different path
        await notifyPlexFolderRefresh(movieFolder, config.PLEX_MOVIES_LIBRARY_ID);

        res.status(200).send("File import processed successfully.");
    } else {
        console.log("⚠️ No valid event received.");
        res.status(200).send("Invalid event."); // should be 500 // rewrite the webhook part for sonarr test webhook
    }
});


// Webhook route to trigger fetching popular Netflix movies
app.get("/justwatch-webhook", async (req: Request, res: Response) => {
    console.log("📩 JustWatch Webhook received");

    // Voor populaire Netflix films in Nederland
    await getMetas('MOVIE', ['nfx'], 'NL', 'en', 10);

    // Voor populaire Netflix series in Nederland
    //await getMetas('SHOW', ['nfx'], 'NL', 'en', 10);

    res.status(200).send("Popular Netflix movies fetched successfully.");
});





// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Webhook server is listening on port ${PORT}`);
});