// src/config/index.ts
import * as dotenv from 'dotenv'; dotenv.config();

export const config = {
    RADARR_URL: process.env.RADARR_URL as string,
    RADARR_API_KEY: process.env.RADARR_API_KEY as string,
    RADARR_MOVIE_FOLDER: process.env.RADARR_MOVIE_FOLDER as string,
    RADARR_MONITOR_TAG_NAME: process.env.RADARR_MONITOR_TAG_NAME as string,
    RADARR_QUALITY_PROFILE_ID: process.env.RADARR_QUALITY_PROFILE_ID as string | undefined,
    
    TMDB_API_KEY: process.env.TMDB_API_KEY as string,

    TAUTULLI_URL: process.env.TAUTULLI_URL as string,
    TAUTULLI_API_KEY: process.env.TAUTULLI_API_KEY as string,
    TAUTULLI_STREAM_TERMINATED_MESSAGE: process.env.TAUTULLI_STREAM_TERMINATED_MESSAGE as string,

    PLEX_MOVIES_LIBRARY_ID: process.env.PLEX_MOVIES_LIBRARY_ID as string,
    PLEX_SERIES_LIBRARY_ID: process.env.PLEX_SERIES_LIBRARY_ID as string,
    PLEX_TOKEN: process.env.PLEX_TOKEN as string,
    PLEX_URL: process.env.PLEX_URL as string,
    PLEX_MOVIE_FOLDER: process.env.PLEX_MOVIE_FOLDER as string,
    PLEX_SERIES_FOLDER: process.env.PLEX_SERIES_FOLDER as string,

    MOVIE_FOLDER_DUMMY: process.env.MOVIE_FOLDER_DUMMY as string,
    DUMMY_FILE_LOCATION: process.env.DUMMY_FILE_LOCATION as string,
    SERIES_FOLDER_DUMMY: process.env.SERIES_FOLDER_DUMMY as string,

    // Radarr 4K (optional)
    RADARR_4K_URL: process.env.RADARR_4K_URL as string | undefined,
    RADARR_4K_API_KEY: process.env.RADARR_4K_API_KEY as string | undefined,
    RADARR_4K_MOVIE_FOLDER: process.env.RADARR_4K_MOVIE_FOLDER as string | undefined,
    RADARR_4K_QUALITY_PROFILE_ID: process.env.RADARR_4K_QUALITY_PROFILE_ID as string | undefined,

    SONARR_URL: process.env.SONARR_URL as string,
    SONARR_API_KEY: process.env.SONARR_API_KEY as string,
    SONARR_MONITOR_TAG_NAME: process.env.SONARR_MONITOR_TAG_NAME as string
};

const requiredKeys = [
    "RADARR_URL",
    "RADARR_API_KEY",
    "RADARR_MOVIE_FOLDER",
    "RADARR_MONITOR_TAG_NAME",
    "RADARR_QUALITY_PROFILE_ID",
    "TMDB_API_KEY",
    "TAUTULLI_URL",
    "TAUTULLI_API_KEY",
    "TAUTULLI_STREAM_TERMINATED_MESSAGE",
    "PLEX_MOVIES_LIBRARY_ID",
    "PLEX_SERIES_LIBRARY_ID",
    "PLEX_TOKEN",
    "PLEX_URL",
    "PLEX_MOVIE_FOLDER",
    "PLEX_SERIES_FOLDER",
    "MOVIE_FOLDER_DUMMY",
    "DUMMY_FILE_LOCATION",
    "SERIES_FOLDER_DUMMY",
    "SONARR_URL",
    "SONARR_API_KEY",
    "SONARR_MONITOR_TAG_NAME"
];

const missingRequiredKeys = requiredKeys.filter(key => !config[key as keyof typeof config]);

if (missingRequiredKeys.length > 0) {
    throw new Error(`❌ Config is missing the following keys: ${missingRequiredKeys.join(", ")}`);
}

if (config.RADARR_4K_URL) {
    const radarr4kRequiredKeys = ["RADARR_4K_API_KEY", "RADARR_4K_MOVIE_FOLDER", "RADARR_4K_QUALITY_PROFILE_ID"];
    const missing4kKeys = radarr4kRequiredKeys.filter(key => !config[key as keyof typeof config]);

    if (missing4kKeys.length > 0) {
        throw new Error(
            `❌ Config is missing the following keys for 4K support: ${missing4kKeys.join(", ")}. ` +
            `These are required when RADARR_4K_URL is provided.`
        );
    }

    if (isNaN(Number(config.RADARR_4K_QUALITY_PROFILE_ID))) {
        throw new Error("❌ Config RADARR_4K_QUALITY_PROFILE_ID does not contain a valid numeric value.");
    }
}