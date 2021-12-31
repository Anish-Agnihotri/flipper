import prompt from "prompt"; // CLI prompt

/**
 * Prompts user to verify they'd like to continue
 * @param {string?} description for prompt
 */
export async function promptVerifyContinue(
  description?: string
): Promise<void> {
  // Verify correct execution parameters
  const { execute } = await prompt.get([
    {
      name: "execute",
      required: true,
      type: "boolean",
      description
    }
  ]);

  if (!execute) {
    // If false, exit process
    process.exit(1);
  }
}
