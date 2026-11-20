import { supabase } from "../lib/supabase";

export interface CompetenceConfig {
  id: string;
  name: string;
  /** Nom du chapitre (dénormalisé depuis la jointure SQL) */
  chapter: string;
  chapter_id: string;
  max_points: number;
}

interface ChapterRow {
  id: string;
  name: string;
  order_index: number;
  emoji: string;
}

interface CompetenceRow {
  id: string;
  name: string;
  max_points: number;
  chapter_id: string;
  chapters: { name: string } | null;
}

export const fetchTaxonomyFromDB = async () => {
  const [chaptersResult, competencesResult] = await Promise.all([
    supabase
      .from("chapters")
      .select("id, name, order_index, emoji")
      .order("order_index", { ascending: true }),
    supabase
      .from("competences")
      .select("id, name, max_points, chapter_id, chapters(name)"),
  ]);

  if (chaptersResult.error)
    throw new Error(`Chapitres: ${chaptersResult.error.message}`);
  if (competencesResult.error)
    throw new Error(`Compétences: ${competencesResult.error.message}`);

  const chapters: ChapterRow[] = chaptersResult.data ?? [];
  const rawCompetences = (competencesResult.data ??
    []) as unknown as CompetenceRow[];

  const chapterOrder = chapters.map((c) => c.name);
  const chapterEmojis: Record<string, string> = Object.fromEntries(
    chapters.map((c) => [c.name, c.emoji ?? "📚"]),
  );

  const competences: CompetenceConfig[] = rawCompetences.map((c) => ({
    id: c.id,
    name: c.name,
    chapter: c.chapters?.name ?? "",
    chapter_id: c.chapter_id,
    max_points: c.max_points,
  }));

  return { chapterOrder, chapterEmojis, competences };
};
