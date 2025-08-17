import { Pinecone } from '@pinecone-database/pinecone'
import { HitToJSON } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch/db_data';

// Initialize a Pinecone client with your API key
export const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

export const movieNameSpace = pinecone.index(process.env.PINECONE_INDEX!, process.env.PINECONE_HOST).namespace(process.env.PINECONE_NAMESPACE!);


// await movieNameSpace.upsertRecords([
//         {
//             "_id": "movie1",
//             "chunk_movie_title": "Inception is a mind-bending thriller where a skilled thief, who steals secrets through dream-sharing technology, is given the inverse task of planting an idea into the mind of a CEO.",
//             "movie_title": "Inception",
//             "genre": "Science Fiction, Thriller",
//             "synopsis": "A thief who enters the dreams of others to steal secrets is tasked with planting an idea instead, leading to a journey through layered realities.",
//         },
//         {
//             "_id": "movie2",
//             "chunk_movie_title": "The Godfather chronicles the powerful Italian-American crime family of Don Vito Corleone as his youngest son, Michael, reluctantly joins the Mafia and becomes the ruthless boss.",
//             "movie_title": "The Godfather",
//             "genre": "Crime, Drama",
//             "synopsis": "The aging patriarch of an organized crime dynasty transfers control of his clandestine empire to his reluctant son.",
//         },
//         {
//             "_id": "movie3",
//             "chunk_movie_title": "Spirited Away follows a young girl who, while moving to a new neighborhood, enters a world of spirits and must find a way to free herself and her parents.",
//             "movie_title": "Spirited Away",
//             "genre": "Animation, Fantasy, Adventure",
//             "synopsis": "A ten-year-old girl wanders into a world ruled by gods, witches, and spirits, and must work in a bathhouse to save her parents.",
//         },
//         {
//             "_id": "movie4",
//             "chunk_movie_title": "The Shawshank Redemption tells the story of Andy Dufresne, a banker sentenced to life in Shawshank State Penitentiary for the murder of his wife and her lover, and his friendship with fellow inmate Red.",
//             "movie_title": "The Shawshank Redemption",
//             "genre": "Drama",
//             "synopsis": "Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.",
//         }
// ]);


const query = "crime drama"

const results = await movieNameSpace.searchRecords({
    query: {
        topK: 10,
        inputs: { text: query },
      },
      rerank: {
        model: 'bge-reranker-v2-m3',
        topN: 10,
        rankFields: ['synopsis'],
      },
    
})


interface Hits {
    _id: string,
    _score: number,
    fields: {
      chunk_movie_title: string,
      genre: string,
      movie_title: string,
      synopsis: string,
    },
  }

const hitsData : Hits[] = results.result.hits.map(hit=> HitToJSON(hit))


let highestScore: number | undefined = undefined;
let highestScoreEntry: Hits | undefined = undefined;

if (hitsData.length > 0) {
  highestScoreEntry = hitsData.reduce((prev, curr) => (curr._score > prev._score ? curr : prev));
  highestScore = highestScoreEntry._score;
}

console.log('Highest score:', highestScore);
if (highestScoreEntry) {
  console.log('Entry with highest score:', highestScoreEntry.fields.movie_title
  );
}
