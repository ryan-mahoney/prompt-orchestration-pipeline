import pLimit from "p-limit";
import path from "node:path";

const CONCURRENCY = 10;

// Helper: Build system prompt for terminology extraction
const buildTermExtractionSystemPrompt = () => {
  return `You are a technical terminology expert. Your task is to identify technical terms, jargon, and abstract concepts from text and provide clear, contextual definitions.

Rules:
- Identify technical terms, domain-specific jargon, and abstract concepts
- Skip common/obvious words that don't require explanation
- Provide ONE SENTENCE definitions based on how the term is used in context
- Focus on terms that would be valuable for a glossary
- Definitions should be clear and contextual to how the term is used in the segment

CRITICAL: You MUST respond with valid JSON in this exact format:
{"terms": [{"term": "example term", "definition": "One sentence definition based on context."}]}

If no significant terms are found in the segment, return:
{"terms": []}

Do not include any text outside the JSON object. No commentary, no explanations, just the JSON.`;
};

// Helper: Build user prompt for terminology extraction
const buildTermExtractionUserPrompt = (
  segment,
  precedingContext,
  followingContext,
  chapterSummary
) => {
  const { overall_summary, main_themes, key_points } = chapterSummary;

  let user = `Identify technical terms, jargon, and abstract concepts in the following segment:\n\n--- SEGMENT ---\n${segment.content}\n--- END SEGMENT ---`;

  if (precedingContext)
    user += `\n\n--- PRECEDING CONTEXT ---\n${precedingContext}`;
  if (followingContext)
    user += `\n\n--- FOLLOWING CONTEXT ---\n${followingContext}`;

  user += `\n\n--- CHAPTER CONTEXT ---\nSummary: ${overall_summary}\nThemes: ${main_themes.join(
    ", "
  )}\nKey Points: ${key_points.join("; ")}`;

  return user;
};

// Helper: Build system prompt for term localization
const buildTermLocalizationSystemPrompt = (language_name, experts) => {
  const expertContext = experts
    .map((e) => `${e.name} (${e.region}): ${e.known_for}`)
    .join("\n");

  return `You are a cultural and linguistic expert specializing in ${language_name}. Your task is to provide culturally and linguistically appropriate translations for technical terms.

Regional Experts for guidance:
${expertContext}

Rules:
- Provide translations that would resonate with native ${language_name} speakers
- Consider regional variations and prefer widely-understood terminology
- Use the experts' areas of expertise to inform terminology choices
- If a term is commonly kept in English in ${language_name} contexts, note that
- Provide brief context on why you chose specific translations

CRITICAL: You MUST respond with valid JSON in this exact format:
{"localized_terms": [{"original_term": "example", "localized_term": "ejemplo", "context": "Brief explanation of translation choice"}]}

Do not include any text outside the JSON object. No commentary, no explanations, just the JSON.`;
};

// Helper: Build user prompt for term localization
const buildTermLocalizationUserPrompt = (terms, language_name) => {
  const termList = terms
    .map((t) => `- "${t.term}": ${t.definition}`)
    .join("\n");

  return `Provide culturally and linguistically appropriate ${language_name} translations for these technical terms:\n\n${termList}`;
};

// Helper: Build system prompt for translation
const buildTranslationSystemPrompt = (language_name, author_voice) => {
  return `You are a professional translator specializing in meaning-preserving translation.

CRITICAL REQUIREMENT - SELF-VERIFICATION:
Before returning your response, you MUST verify that your translation is actually in ${language_name}.
- If the output text is still in the source language (English), this is a CRITICAL ERROR
- Re-read your translation and confirm it uses ${language_name} vocabulary and grammar
- Do NOT return the original text unchanged - that defeats the entire purpose
- When in doubt, actively translate every word and phrase to ${language_name}

Rules:
- Preserve the meaning and intent, not literal word-for-word translation
- Maintain all markdown formatting (headers, bold, italic, links, etc.)
- Match the author's voice and tone: ${
    author_voice || "professional, clear, engaging"
  }
- Target language: ${language_name}

=== FORMATTING GUIDE ===

The source uses Pandoc markdown with Typst extensions. Follow these rules exactly:

INLINE INDEX MARKERS:
When you see: text\`#index[Term]\`{=typst}
Action: Translate BOTH the visible text AND the term inside the brackets
Example: "imposter syndrome\`#index[Imposter syndrome]\`{=typst}"
Becomes: "síndrome del impostor\`#index[Síndrome del impostor]\`{=typst}"
Note: The index term should be in the target language so readers can look up entries in their language

FOOTNOTE REFERENCES:
When you see: [^020-1] or similar
Action: Preserve exactly as-is, do not modify

HTML TAGS:
When you see: <span class="small">_Figure 1.1 — Caption text._</span>
Action: Translate the text inside, keep all HTML tags and attributes unchanged
Example: <span class="small">_Figura 1.1 — Texto del pie de figura._</span>

EMPHASIZED TEXT:
When you see: _italic_ or **bold** or ***bold italic***
Action: Translate the text, preserve the markdown markers around it

LINKS:
When you see: [link text](url)
Action: Translate the link text, preserve the URL unchanged

HORIZONTAL RULES:
When you see: ---
Action: Preserve exactly as-is

=== END FORMATTING GUIDE ===

=== TERMINOLOGY GUIDANCE ===
When the user provides a "TERMINOLOGY GUIDANCE" section with pre-approved translations for key terms:
- You MUST use those exact translations for the specified terms
- These translations have been carefully chosen by regional experts for cultural and linguistic accuracy
- Do not substitute alternative translations for these terms - the provided translations are authoritative
- If a term appears in the guidance, always prefer the provided translation over your own choice
=== END TERMINOLOGY GUIDANCE ===

CRITICAL: You MUST respond with valid JSON in this exact format:
{"translated": "your translated text here", "verified_language": "${language_name}"}

The "verified_language" field confirms you have checked that your translation is in ${language_name}, not the source language.
If you find yourself about to return text in the source language, STOP and re-translate it to ${language_name}.

Do not include any text outside the JSON object. No commentary, no explanations, just the JSON.`;
};

// Helper: Build user prompt for translation with term context
const buildTranslationUserPrompt = (
  segment,
  precedingContext,
  followingContext,
  chapterSummary,
  experts,
  language_name,
  localizedTerms
) => {
  const { overall_summary, main_themes, key_points } = chapterSummary;

  let user = `Translate the following segment to ${language_name}:\n\n--- SEGMENT ---\n${segment.content}\n--- END SEGMENT ---`;

  if (precedingContext)
    user += `\n\n--- PRECEDING CONTEXT ---\n${precedingContext}`;
  if (followingContext)
    user += `\n\n--- FOLLOWING CONTEXT ---\n${followingContext}`;

  user += `\n\n--- CHAPTER CONTEXT ---\nSummary: ${overall_summary}\nThemes: ${main_themes.join(
    ", "
  )}\nKey Points: ${key_points.join("; ")}`;

  user += `\n\n--- REGIONAL EXPERTS ---\n${experts
    .map((e) => `${e.name} (${e.region}): ${e.known_for}`)
    .join("\n")}`;

  // Add localized terms context if available
  if (localizedTerms && localizedTerms.length > 0) {
    user += `\n\n--- TERMINOLOGY GUIDANCE ---\nUse these culturally-appropriate translations for key terms:\n`;
    user += localizedTerms
      .map(
        (t) =>
          `- "${t.original_term}" → "${t.localized_term}" (${
            t.context || "preferred translation"
          })`
      )
      .join("\n");
  }

  return user;
};

// Process a single translation job
async function processJob(job, db, llm) {
  // Mark job as processing
  db.prepare(
    `UPDATE translation_jobs SET status = 'processing', started_at = datetime('now') WHERE id = ?`
  ).run(job.id);

  try {
    // Parse JSON fields
    const languages = JSON.parse(job.languages);
    const chapterSummary = JSON.parse(job.chapter_summary);

    // Non-translatable segments: pass through unchanged
    if (["code_block", "image", "directive"].includes(job.segment_type)) {
      const insertResult = db.prepare(`
      INSERT INTO translation_results (job_id, language_code, translated_content, extracted_terms, localized_terms)
      VALUES (?, ?, ?, NULL, NULL)
    `);

      for (const { language_code } of languages) {
        insertResult.run(job.id, language_code, job.segment_content);
      }

      db.prepare(
        `UPDATE translation_jobs SET status = 'complete', completed_at = datetime('now') WHERE id = ?`
      ).run(job.id);
      return;
    }

    // Build segment object for term extraction
    const segment = { index: job.segment_index, content: job.segment_content };

    // Extract terms from segment
    let extractedTerms = [];
    try {
      const termSystemPrompt = buildTermExtractionSystemPrompt();
      const termUserPrompt = buildTermExtractionUserPrompt(
        segment,
        job.preceding_context,
        job.following_context,
        chapterSummary
      );

      const termResponse = await llm.deepseek.chat({
        messages: [
          { role: "system", content: termSystemPrompt },
          { role: "user", content: termUserPrompt },
        ],
      });

      const termRawContent =
        typeof termResponse.content === "string"
          ? termResponse.content
          : JSON.stringify(termResponse.content);

      const termParsed = JSON.parse(termRawContent);
      extractedTerms = termParsed.terms || [];
    } catch {
      // Continue without terms - don't fail the translation
    }

    // Process each target language
    const insertResult = db.prepare(`
    INSERT INTO translation_results (job_id, language_code, translated_content, extracted_terms, localized_terms)
    VALUES (?, ?, ?, ?, ?)
  `);

    for (const { language_code, language_name, experts } of languages) {
      let localizedTerms = [];

      // Localize terms for this language (if we have terms and experts)
      if (extractedTerms.length > 0 && experts.length > 0) {
        try {
          const localizationSystemPrompt = buildTermLocalizationSystemPrompt(
            language_name,
            experts
          );
          const localizationUserPrompt = buildTermLocalizationUserPrompt(
            extractedTerms,
            language_name
          );

          const localizationResponse = await llm.deepseek.chat({
            messages: [
              { role: "system", content: localizationSystemPrompt },
              { role: "user", content: localizationUserPrompt },
            ],
          });

          const localizationRawContent =
            typeof localizationResponse.content === "string"
              ? localizationResponse.content
              : JSON.stringify(localizationResponse.content);

          const localizationParsed = JSON.parse(localizationRawContent);
          localizedTerms = localizationParsed.localized_terms || [];
        } catch {
          // Continue without localized terms
        }
      }

      // Translate segment with enriched context
      const translationSystemPrompt = buildTranslationSystemPrompt(
        language_name,
        job.author_voice
      );
      const translationUserPrompt = buildTranslationUserPrompt(
        segment,
        job.preceding_context,
        job.following_context,
        chapterSummary,
        experts,
        language_name,
        localizedTerms
      );

      const response = await llm.deepseek.reasoner({
        messages: [
          { role: "system", content: translationSystemPrompt },
          { role: "user", content: translationUserPrompt },
        ],
      });

      const rawContent =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      const parsed = JSON.parse(rawContent);
      const translatedContent = parsed.translated;

      // Insert result into database
      insertResult.run(
        job.id,
        language_code,
        translatedContent,
        JSON.stringify(extractedTerms),
        JSON.stringify(localizedTerms)
      );
    }

    // Mark job as complete
    db.prepare(
      `UPDATE translation_jobs SET status = 'complete', completed_at = datetime('now') WHERE id = ?`
    ).run(job.id);
  } catch (error) {
    // Mark job as failed with error message and increment retry count
    db.prepare(
      `UPDATE translation_jobs SET status = 'failed', error_message = ?, retry_count = retry_count + 1 WHERE id = ?`
    ).run(error.message, job.id);

    // Re-throw to propagate to Promise.allSettled
    throw error;
  }
}

// Main inference stage - concurrent job execution with retry loop
export const inference = async ({ io, llm, flags }) => {
  const Database = (await import("better-sqlite3")).default;

  // Compute dbPath directly instead of relying on data.setup.dbPath
  const dbPath = path.join(
    io.getTaskDir(),
    "..",
    "..",
    "files",
    "artifacts",
    "translation-jobs.db"
  );

  const db = new Database(dbPath);
  const limit = pLimit(CONCURRENCY);

  let totalCompleted = 0;
  let totalFailed = 0;
  let totalRetries = 0;
  const MAX_PASSES = 5;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Query pending or failed jobs that haven't exceeded retry limit
    const jobs = db
      .prepare(
        `SELECT * FROM translation_jobs 
         WHERE status IN ('pending', 'failed') AND retry_count < 5 
         ORDER BY segment_index`
      )
      .all();

    if (jobs.length === 0) break;

    // Process jobs concurrently with limit
    const results = await Promise.allSettled(
      jobs.map((job) => limit(() => processJob(job, db, llm)))
    );

    const passCompleted = results.filter(
      (r) => r.status === "fulfilled"
    ).length;
    const passFailed = results.filter((r) => r.status === "rejected").length;

    totalCompleted += passCompleted;

    // Check if there are retryable failed jobs
    const retryableCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM translation_jobs 
         WHERE status = 'failed' AND retry_count < 5`
      )
      .get().count;

    if (retryableCount === 0) {
      // No more retryable jobs, we're done
      break;
    }

    // Increment retry counter for next pass
    if (pass < MAX_PASSES - 1) {
      totalRetries++;
    }
  }

  // Get final counts
  const finalCompleted = db
    .prepare(
      `SELECT COUNT(*) as count FROM translation_jobs WHERE status = 'complete'`
    )
    .get().count;
  const finalFailed = db
    .prepare(
      `SELECT COUNT(*) as count FROM translation_jobs WHERE status = 'failed'`
    )
    .get().count;

  db.close();

  return {
    output: { completed: finalCompleted, failed: finalFailed, totalRetries },
    flags,
  };
};
