CREATE TABLE "mappings" (
	"anilist_id" integer PRIMARY KEY,
	"mal_id" integer,
	"kitsu_id" integer,
	"anidb_id" integer,
	"tvdb_id" integer,
	"tmdb_id" integer,
	"episodes" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
