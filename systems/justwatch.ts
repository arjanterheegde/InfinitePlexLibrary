import axios from "axios";
import { addMovieToRadarr } from "./radarr";
import { config } from "../config";
import { getTmdbIdFromImdbId } from "./tmdb";

export async function getMetas(type = 'MOVIE', providers = ['nfx'], country = "GB", language = 'en', amount = 10): Promise<void> {
    try {
        const response = await axios.post('https://apis.justwatch.com/graphql', {
            "operationName": "GetPopularTitles",
            "variables": {
                "popularTitlesSortBy": "TRENDING",
                "first": amount,
                "platform": "WEB",
                "sortRandomSeed": 0,
                "popularAfterCursor": "",
                "offset": null,
                "popularTitlesFilter": {
                    "ageCertifications": [],
                    "excludeGenres": [],
                    "excludeProductionCountries": [],
                    "genres": [],
                    "objectTypes": [type],
                    "productionCountries": [],
                    "packages": providers,
                    "excludeIrrelevantTitles": false,
                    "presentationTypes": [],
                    "monetizationTypes": ["FREE", "FLATRATE", "ADS"]
                },
                "language": language,
                "country": country
            },
            "query": `query GetPopularTitles(
                $country: Country!
                $popularTitlesFilter: TitleFilter
                $popularAfterCursor: String
                $popularTitlesSortBy: PopularTitlesSorting! = POPULAR
                $first: Int!
                $language: Language!
                $offset: Int = 0
                $sortRandomSeed: Int! = 0
                $profile: PosterProfile
                $backdropProfile: BackdropProfile
                $format: ImageFormat
            ) {
                popularTitles(
                    country: $country
                    filter: $popularTitlesFilter
                    offset: $offset
                    after: $popularAfterCursor
                    sortBy: $popularTitlesSortBy
                    first: $first
                    sortRandomSeed: $sortRandomSeed
                ) {
                    totalCount
                    pageInfo {
                        startCursor
                        endCursor
                        hasPreviousPage
                        hasNextPage
                        __typename
                    }
                    edges {
                        ...PopularTitleGraphql
                        __typename
                    }
                    __typename
                }
            }
            fragment PopularTitleGraphql on PopularTitlesEdge {
                cursor
                node {
                    id
                    objectId
                    objectType
                    content(country: $country, language: $language) {
                        externalIds {
                            imdbId
                        }
                        title
                        fullPath
                        scoring {
                            imdbScore
                            __typename
                        }
                        posterUrl(profile: $profile, format: $format)
                        ... on ShowContent {
                            backdrops(profile: $backdropProfile, format: $format) {
                                backdropUrl
                                __typename
                            }
                            __typename
                        }
                        __typename
                    }
                    __typename
                }
                __typename
            }`
        });

        if (response.data && response.data.data && response.data.data.popularTitles) {
            const items = response.data.data.popularTitles.edges;
            console.log(`📺 Popular ${type === 'MOVIE' ? 'Movies' : 'Series'} in ${country}:`);
            for (const item of items) {

                const title = item.node.content.title;
                const imdbId = item.node.content.externalIds.imdbId;
                console.log(`🎬 ${title} (${imdbId})`);

                const tmdbId = await getTmdbIdFromImdbId(imdbId);
                if (!tmdbId) {
                    continue;
                }

                // Add movie to Radarr
                if (type === 'MOVIE') {
                    try {
                        const newMovie = await addMovieToRadarr(
                            tmdbId,
                            config.RADARR_MOVIE_FOLDER!,
                            Number(config.RADARR_QUALITY_PROFILE_ID),
                            false, // unmonitored
                            false, // search for movie
                            config.RADARR_URL!,
                            config.RADARR_API_KEY!,
                            ["dummy"]
                        );
                        console.log(`✅ Movie added to Radarr: ${newMovie.title}`);
                    } catch (error: any) {
                        console.error(`❌ Error adding movie to Radarr: ${error.message}`);
                    }
                }
            }
        } else {
            console.error("❌ Error fetching popular titles: Invalid response format");
        }
    } catch (error: any) {
        console.error("❌ Error fetching popular titles:", error.message);
    }
}