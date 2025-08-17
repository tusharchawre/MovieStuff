import { prisma } from "@repo/db/client";
import { movieNameSpace, pinecone } from "@repo/pinecone/client";
import axios from "axios";

interface MovieResponse {
  adult: boolean;
  backdrop_path: string;
  genre_ids: number[];
  id: number;
  original_language: string;
  original_title: string;
  overview: string;
  popularity: number;
  poster_path: string;
  release_date: string; //YYYY-MM-DD
  title: string;
  video: boolean;
  vote_average: number;
  vote_count: number;
}

// Create axios instance with retry configuration
const tmdbApi = axios.create({
  timeout: 10000, // 10 second timeout
  headers: {
    accept: "application/json",
    Authorization:
      `Bearer ${process.env.TMDB_AUTH}` ,
  },
});

// Add retry interceptor
tmdbApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;

    // If no config or already retried max times, reject
    if (!config || config.__retryCount >= 3) {
      return Promise.reject(error);
    }

    // Initialize retry count
    config.__retryCount = config.__retryCount || 0;
    config.__retryCount += 1;

    // Check if it's a retryable error
    const retryableErrors = [
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ECONNREFUSED",
    ];
    const isRetryable =
      retryableErrors.some(
        (errCode) => error.code === errCode || error.message?.includes(errCode)
      ) ||
      (error.response && error.response.status >= 500);

    if (isRetryable) {
      console.log(
        `Retrying request (${config.__retryCount}/3) for ${config.url}`
      );

      // Exponential backoff delay
      const delay = Math.pow(2, config.__retryCount) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));

      return tmdbApi(config);
    }

    return Promise.reject(error);
  }
);

// Utility function to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchMovies = async (
  pageNumber: number = 1
): Promise<MovieResponse[]> => {
  try {
    const res = await tmdbApi.get(
      `https://api.themoviedb.org/3/discover/movie?sort_by=popularity.desc&page=${pageNumber}`
    );
    return res.data.results;
  } catch (error) {
    console.error("❌ Failed to fetch movies:", error);
    throw error;
  }
};

const fetchMovieData = async (movieId: number, retries = 3): Promise<any> => {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await tmdbApi.get(
        `https://api.themoviedb.org/3/movie/${movieId}`
      );
      return res.data;
    } catch (error: any) {
      console.log(
        `Attempt ${i + 1} failed for movie ${movieId}:`,
        error.message
      );

      if (i === retries - 1) {
        throw error;
      }

      // Wait before retrying (exponential backoff)
      await delay(Math.pow(2, i) * 1000);
    }
  }
};

const fetchAllPages = async () => {
  const allMovies = [];

  for (let i = 1; i < 25; i++) {
    try {
      const moviePage = await fetchMovies(i);
      allMovies.push(...moviePage);
    } catch (e) {
      console.log(`Movie page ${i} was not fetched.`);
    }
  }

  return allMovies;
};

const uploadToPrisma = async () => {
  try {
    const movies = await fetchAllPages();

    console.log(`📥 Fetched ${movies.length} movies`);

    // Process movies sequentially to avoid overwhelming the API
    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i]!;

      try {
        console.log(
          `Processing movie ${i + 1}/${movies.length}: ${movie.title}`
        );

        await prisma.$transaction(
          async (tx) => {
            // Check if movie already exists
            const existingMovie = await tx.movie.findFirst({
              where: { tmdbId: movie.id },
            });

            if (existingMovie) {
              console.log(
                `⏭️  Movie "${movie.title}" already exists, skipping...`
              );
              return;
            }

            const movieItem = await tx.movie.create({
              data: {
                movieTitle: movie.title,
                tmdbId: movie.id,
                synopsis: movie.overview,
                releaseDate: new Date(movie.release_date),
                posterUrl: `https://image.tmdb.org/t/p/original/${movie.poster_path}`,
                backdropUrl: `https://image.tmdb.org/t/p/original/${movie.backdrop_path}`,
              },
            });

            // Fetch additional movie details
            try {
              const movieDetails = await fetchMovieData(movie.id);

              await tx.movie.update({
                where: { id: movieItem.id },
                data: {
                  genres:
                    movieDetails.genres?.map((genre: any) => genre.name) || [],
                  runtime: movieDetails.runtime || null,
                  imdbId: movieDetails.imdb_id || null,
                },
              });

              console.log(`✅ Successfully processed: ${movie.title}`);
            } catch (detailsError: any) {
              console.log(
                `⚠️  Created movie "${movie.title}" but couldn't fetch details:`,
                detailsError.message
              );
            }
          },
          {
            timeout: 30000,
          }
        );

        // Rate limiting: wait between requests
        await delay(100); // 100ms delay between movies
      } catch (error: any) {
        console.error(
          `❌ Failed to process movie "${movie.title}":`,
          error.message
        );
        // Continue with next movie instead of stopping the entire process
        continue;
      }
    }

    console.log("🎉 Movie upload process completed!");
  } catch (error: any) {
    console.error("❌ Failed to upload movies:", error.message);
    throw error;
  }
};

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

// uploadToPrisma().catch(console.error);



const uploadToVectorDB = async () => {
  try {
    const movies = await prisma.movie.findMany({});

    console.log(`📥 Fetched ${movies.length} movies`);

    // Process movies sequentially to avoid overwhelming the API
    for (let i = 0; i < movies.length; i++) {
      const movie = movies[i]!;

      try {
        console.log(
          `Processing movie ${i + 1}/${movies.length}: ${movie.movieTitle}`
        );

        await movieNameSpace.upsertRecords([
          {
            _id: movie.id,
            title: movie.movieTitle,
            synopsis: movie.synopsis,
            genre: movie.genres,
            runtime: movie.runtime || 0
          },
        ]);

        await delay(100);
      } catch (error: any) {
        console.error(
          `❌ Failed to process movie "${movie.movieTitle}":`,
          error.message
        );

        continue;
      }
    }

    console.log("🎉 Movie upload to PineCone completed!");
  } catch (error: any) {
    console.error("❌ Failed to upload movies:", error.message);
    throw error;
  }
};

// uploadToVectorDB().catch(console.error);