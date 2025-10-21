export function humanizePipelineSlug(slug) {
  if (!slug || typeof slug !== "string") return "";
  return slug
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function derivePipelineMetadata(source = {}) {
  const pipelineValue = source?.pipeline;
  const pipelineSlugFromSource =
    source?.pipelineSlug ??
    (typeof pipelineValue === "string" ? pipelineValue : null);

  const pipelineLabel =
    source?.pipelineLabel ??
    (typeof pipelineSlugFromSource === "string"
      ? humanizePipelineSlug(pipelineSlugFromSource)
      : null);

  const pipelineObject =
    pipelineValue &&
    typeof pipelineValue === "object" &&
    !Array.isArray(pipelineValue)
      ? pipelineValue
      : null;

  const pipeline =
    pipelineObject ??
    (typeof pipelineSlugFromSource === "string"
      ? pipelineSlugFromSource
      : null);

  return {
    pipeline,
    pipelineSlug:
      typeof pipelineSlugFromSource === "string"
        ? pipelineSlugFromSource
        : null,
    pipelineLabel: pipelineLabel || null,
  };
}
