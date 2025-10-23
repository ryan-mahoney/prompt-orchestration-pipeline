export const validateStructure = async (context) => ({
        output: { validationPassed: true },
        flags: { validationFailed: false },
      });
export const critique = async (context) => ({
        output: { critique: "good" },
        flags: { critiqueComplete: true },
      });
export const refine = async (context) => ({
        output: { refined: true },
        flags: { refined: true },
      });
export default { validateStructure, critique, refine };