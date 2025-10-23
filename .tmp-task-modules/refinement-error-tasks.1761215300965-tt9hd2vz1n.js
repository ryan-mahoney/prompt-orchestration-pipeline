export const validateStructure = async (context) => {
          throw new Error("Schema validation failed");
        };
export const critique = async (context) => ({
          output: { critique: "needs improvement" },
          flags: { critiqueComplete: true },
        });
export const refine = async (context) => ({
          output: { refined: true },
          flags: { refined: true },
        });
export default { validateStructure, critique, refine };