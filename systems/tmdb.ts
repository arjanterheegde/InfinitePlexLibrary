import axios from "axios";
import { config } from "../config";

// Function to get TMDb ID from IMDb ID
export async function getTmdbIdFromImdbId(imdbId: string): Promise<string | null> {
    try {
        const response = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
            params: {
                api_key: config.TMDB_API_KEY,
                external_source: "imdb_id"
            }
        });

        if (response.data && response.data.movie_results && response.data.movie_results.length > 0) {
            return response.data.movie_results[0].id;
        } else {
            console.error(`❌ No TMDb ID found for IMDb ID: ${imdbId}`);
            return null;
        }
    } catch (error: any) {
        console.error(`❌ Error fetching TMDb ID for IMDb ID: ${imdbId}`, error.message);
        return null;
    }
}
