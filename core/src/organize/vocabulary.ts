// The shelves Magpie sorts books onto: two kinds, a fixed list of genres
// under each, and a short list of vibes. A fixed list keeps the sidebar tidy
// (no "General", no "FICTION / Science Fiction / Space Opera") and lets the
// bench score every guess.
//
// `subjects` matches what books and Calibre already say (BISAC headings, Library
// of Congress subjects, people's own tags), one part at a time. `about` is what
// the local model compares a book's blurb with; it's written like a blurb so the
// two read alike.

export type Kind = "Fiction" | "Nonfiction";

export interface Genre {
  name: string;
  kind: Kind;
  subjects: RegExp;
  about: string;
}

export interface Vibe {
  name: string;
  about: string;
}

export const KINDS: Kind[] = ["Fiction", "Nonfiction"];

export const GENRES: Genre[] = [
  // Fiction
  {
    name: "Science Fiction",
    kind: "Fiction",
    subjects: /science.?fiction|\bsci.?fi\b|space opera|cyberpunk|dystopia|time travel|\blitrpg\b|gamelit/i,
    about: "A science fiction novel about space travel, aliens, the far future, advanced technology, artificial intelligence or dystopian worlds.",
  },
  {
    name: "Fantasy",
    kind: "Fiction",
    subjects: /fantasy|\bmagic\b|dragons|sword.and.sorcery|fairy tales|\bmyth/i,
    about: "A fantasy novel with magic, dragons, wizards, quests, kingdoms and invented worlds.",
  },
  {
    name: "Mystery",
    kind: "Fiction",
    subjects: /myster|detective|crime|whodunit|private investigators|police procedural|sherlock/i,
    about: "A mystery novel where a detective investigates a murder or crime, follows clues and unmasks the culprit.",
  },
  {
    name: "Thriller",
    kind: "Fiction",
    subjects: /thriller|suspense|espionage|\bspies\b|spy stories|legal fiction/i,
    about: "A tense thriller full of suspense, danger, conspiracies, spies, chases and a race against time.",
  },
  {
    name: "Horror",
    kind: "Fiction",
    subjects: /horror|ghost stories|vampires|supernatural|gothic/i,
    about: "A horror novel with ghosts, monsters, vampires, dread and terrifying supernatural events.",
  },
  {
    name: "Romance",
    kind: "Fiction",
    subjects: /romance|love stories|love & romance/i,
    about: "A romance novel about two people falling in love, courtship, relationships and a happy ending.",
  },
  {
    name: "Historical Fiction",
    kind: "Fiction",
    subjects: /historical fiction|fiction.*historical|historical.*fiction|historical novels|^historical$/i,
    about: "A historical novel set in a real past era, such as a war, an old kingdom or a bygone century, with period detail.",
  },
  {
    name: "Adventure",
    kind: "Fiction",
    subjects: /adventure|sea stories|action & adventure|westerns?\b|survival/i,
    about: "An adventure story of journeys, exploration, shipwrecks, battles, treasure and daring escapes.",
  },
  {
    name: "Short Stories",
    kind: "Fiction",
    subjects: /short stories|anthologies|\bstories\b/i,
    about: "A collection of short stories by one author or an anthology of tales.",
  },
  {
    name: "Comics & Graphic Novels",
    kind: "Fiction",
    subjects: /comics|graphic novels|manga/i,
    about: "A graphic novel or comic book told in drawn panels.",
  },
  {
    name: "Poetry & Drama",
    kind: "Fiction",
    subjects: /poetry|poems|drama|plays|verse/i,
    about: "A book of poems or a play written for the stage.",
  },
  {
    name: "Young Adult & Children's",
    kind: "Fiction",
    subjects: /juvenile|young adult|children's|\bteen\b|\bya\b/i,
    about: "A children's book or young adult novel about growing up, school, friendship and coming of age.",
  },
  {
    name: "Humor",
    kind: "Fiction",
    subjects: /humou?r|satire|comedy|humorous/i,
    about: "A funny, comic novel full of jokes, satire and absurd situations.",
  },
  {
    name: "Literary Fiction",
    kind: "Fiction",
    subjects: /literary fiction|^literary$|fiction.*literary|psychological fiction|domestic fiction|^modern$|^contemporary$|family life.*fiction|bildungsroman/i,
    about: "A literary novel about ordinary lives, families, love, grief and the inner life of its characters, written with care for language.",
  },
  // Nonfiction
  {
    name: "Biography & Memoir",
    kind: "Nonfiction",
    subjects: /biograph|memoir|autobiograph|personal memoirs|presidents|diaries|letters/i,
    about: "A biography or memoir telling the true story of a real person's life, career and experiences.",
  },
  {
    name: "History",
    kind: "Nonfiction",
    subjects: /^history|history$|history &|military history|world war|civil war|ancient|medieval|\bcentury\b/i,
    about: "A history book about past events, wars, empires, civilizations and how the world came to be.",
  },
  {
    name: "Business",
    kind: "Nonfiction",
    subjects: /business|economics|entrepreneur|marketing|sales|startups?|corporate|industries|consumer behavior|negotiat/i,
    about: "A business book about companies, startups, strategy, markets, innovation, products and economics.",
  },
  {
    name: "Management & Leadership",
    kind: "Nonfiction",
    subjects: /management|leadership|human resources|workplace|organizational behavior|teams/i,
    about: "A book on management and leadership: running teams, managing people, hiring, executives and organizations.",
  },
  {
    name: "Money & Investing",
    kind: "Nonfiction",
    subjects: /invest|finance|stocks|securities|money|wealth|personal finance|financial/i,
    about: "A book about investing, the stock market, personal finance, wealth and managing money.",
  },
  {
    name: "Self-Help",
    kind: "Nonfiction",
    subjects: /self.help|personal growth|motivational|inspirational|success|happiness|self.esteem|self.improvement|time management|productivity|habits/i,
    about: "A self-help book on personal growth, habits, happiness, productivity, purpose and living a better life.",
  },
  {
    name: "Psychology",
    kind: "Nonfiction",
    subjects: /psycholog|emotions|mental health|neuroscience|cognitive|depression|anxiety|human sexuality|addiction/i,
    about: "A psychology book about the mind, emotions, behavior, mental health and why people think and act as they do.",
  },
  {
    name: "Relationships & Family",
    kind: "Nonfiction",
    subjects: /relationships|family|parenting|marriage|dating|interpersonal|couples/i,
    about: "A book about relationships, dating, marriage, parenting, family life and communicating with the people you love.",
  },
  {
    name: "Philosophy",
    kind: "Nonfiction",
    subjects: /philosoph|ethics|stoic|existential|pragmatism|logic|metaphysics/i,
    about: "A philosophy book about ethics, meaning, knowledge, how to live, and the ideas of great thinkers.",
  },
  {
    name: "Religion & Spirituality",
    kind: "Nonfiction",
    subjects: /religion|spiritual|\bzen\b|buddhis|christian|meditation|mindfulness|theology|bible|mysticism|esoteric|occult|new age/i,
    about: "A book on religion, spirituality, meditation, mindfulness, faith and the sacred.",
  },
  {
    name: "Politics & Society",
    kind: "Nonfiction",
    subjects: /politic|social science|sociology|race relations|discrimination|feminism|women's studies|ethnic studies|social classes|public policy|government|current affairs|cultural|poverty/i,
    about: "A book about politics, society, culture, race, gender, inequality, government and public life.",
  },
  {
    name: "Science & Nature",
    kind: "Nonfiction",
    subjects: /^science\b(?!.?fiction)|^nature$|natural history|physics|biology|chemistry|astronomy|evolution|ecology|climate|mathematics|^energy$|nuclear|medical|medicine|environmental/i,
    about: "A popular science book about physics, biology, the universe, evolution, nature, medicine or how things work.",
  },
  {
    name: "Technology & Programming",
    kind: "Nonfiction",
    subjects: /computer|programming|software|technology|engineering|data|internet|databases|web|algorithms|pragmatic bookshelf/i,
    about: "A technical book about software engineering, programming, computer systems, data and technology.",
  },
  {
    name: "Health & Fitness",
    kind: "Nonfiction",
    subjects: /health|fitness|diet|nutrition|exercise|wellness|sleep/i,
    about: "A book about health, fitness, diet, nutrition, exercise, sleep and taking care of your body.",
  },
  {
    name: "Food & Cooking",
    kind: "Nonfiction",
    subjects: /cook|recipes|food|culinary|restaurants|wine/i,
    about: "A book about food, cooking, recipes, chefs and restaurants.",
  },
  {
    name: "Travel",
    kind: "Nonfiction",
    subjects: /travel|voyages|description and travel/i,
    about: "A travel book about journeys to other countries, places, landscapes and cultures.",
  },
  {
    name: "Art & Design",
    kind: "Nonfiction",
    subjects: /^arts?\b|^art$|^design$|graphic design|architecture|photography|^music|^film|creativity/i,
    about: "A book about art, design, architecture, music, film and the creative process.",
  },
  {
    name: "Writing & Language",
    kind: "Nonfiction",
    subjects: /writing|language arts|linguistics|grammar|composition|authorship|literary criticism|literature/i,
    about: "A book about writing, language, words, literature and the craft of authors.",
  },
  {
    name: "Essays",
    kind: "Nonfiction",
    subjects: /essays|literary collections/i,
    about: "A collection of essays and short nonfiction pieces on varied subjects.",
  },
];

export const VIBES: Vibe[] = [
  { name: "Cozy", about: "A warm, gentle, comforting, cozy story of small towns, friendship, tea and kindness." },
  { name: "Dark", about: "A dark, bleak, disturbing book about violence, cruelty, despair and the worst of people." },
  { name: "Funny", about: "A hilarious, witty, laugh-out-loud funny book." },
  { name: "Epic", about: "A sweeping epic saga of vast scope, many characters, great wars and the fate of worlds." },
  { name: "Heartfelt", about: "A moving, emotional, tender book about love, loss, grief and hope that will make you cry." },
  { name: "Mind-bending", about: "A strange, surreal, mind-bending book of twists, puzzles and reality-warping ideas." },
  { name: "Fast-paced", about: "A gripping, fast-paced page-turner with nonstop action you can't put down." },
  { name: "Thought-provoking", about: "A thought-provoking book of big ideas that challenges how you see the world." },
  { name: "Practical", about: "A practical, hands-on guide with step-by-step advice, frameworks and exercises you can use." },
  { name: "Inspiring", about: "An inspiring, uplifting book about resilience, purpose and achieving your dreams." },
];

export const GENRE_NAMES = new Set(GENRES.map((g) => g.name));
export const VIBE_NAMES = new Set(VIBES.map((v) => v.name));

export function kindOf(genre: string): Kind | undefined {
  return GENRES.find((g) => g.name === genre)?.kind;
}
