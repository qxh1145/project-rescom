import {
  AiGatewayPromptPayload,
  AiPromptSubmissionInput,
} from '@rescom/schemas';

export class AiPromptService {
  private readonly SUPPORTED_BLOCK_TYPES = [
    'text',
    'textarea',
    'number',
    'single_choice',
    'multiple_choice',
    'rating',
    'linear_scale',
    'date',
    'file_upload',
  ];

  /**
   * Constructs the structured AI Gateway prompt payload containing authoritative
   * Form Definition schema constraints and the sanitized publisher prompt.
   */
  buildPromptPayload(input: AiPromptSubmissionInput): AiGatewayPromptPayload {
    const preferencesSection = this.buildPreferencesSection(input);
    const systemPrompt = this.buildSystemPrompt(preferencesSection);

    return {
      systemPrompt,
      formSchemaContract: {
        schemaVersion: 1,
        supportedBlockTypes: [...this.SUPPORTED_BLOCK_TYPES],
        constraints: {
          minBlocks: 1,
          maxBlocks: 30,
          maxTitleLength: 200,
          maxDescriptionLength: 2000,
        },
      },
      userPrompt: input.prompt,
      options: {
        temperature: 0.2,
        maxTokens: 4000,
        targetQuestionCount: input.targetQuestionCount,
      },
    };
  }

  private buildPreferencesSection(input: AiPromptSubmissionInput): string {
    const lines: string[] = [];

    if (input.targetQuestionCount !== undefined) {
      lines.push(`- Target Questions: ${input.targetQuestionCount}`);
    }

    if (input.preferredBlockTypes && input.preferredBlockTypes.length > 0) {
      lines.push(
        `- Preferred Question Types: ${input.preferredBlockTypes.join(', ')}`,
      );
    }

    if (lines.length === 0) {
      return '';
    }

    return `\n## Publisher Preferences:\n${lines.join('\n')}\n`;
  }

  private buildSystemPrompt(preferencesSection: string): string {
    return `You are an expert survey architect for the RESCOM research platform.
Your task is to generate a comprehensive, high-quality survey structure based on the publisher's requirements.

## CRITICAL OUTPUT CONSTRAINTS:
1. You MUST output raw JSON ONLY conforming exactly to the RESCOM Form Definition JSON contract.
2. Do NOT wrap output in markdown codeblocks (no \`\`\`json or \`\`\`).
3. Do NOT include any introductory or concluding conversational text.

## RESCOM Form Definition JSON Contract:
Root object must contain:
- "schemaVersion": 1 (integer)
- "title": Concise, professional survey title (max 200 chars)
- "description": Contextual explanation or instructions for respondents (optional, max 2000 chars)
- "settings": {
    "shuffleBlocks": false,
    "progressBar": true,
    "requireAuth": false,
    "submitButtonText": "Submit Survey"
  }
- "metadata": {
    "expectedEffortSeconds": estimated completion time in seconds (minimum 15, e.g. 60-300),
    "minTimeBarrierSeconds": speedrun prevention threshold (e.g. 15-45 seconds)
  }
- "blocks": Non-empty array of block objects. Every block MUST have:
  - "id": Unique string identifier (e.g. "blk-1", "blk-2", "blk-3")
  - "order": 0-indexed sequential integer
  - "title": Question text (max 500 chars)
  - "required": boolean
  - "type": One of the exactly 9 supported block types:
    1. "text": Short text input (optional: "placeholder", "minLength", "maxLength")
    2. "textarea": Multi-line text input (optional: "placeholder", "minLength", "maxLength")
    3. "number": Numeric response (optional: "min", "max", "step", "integerOnly")
    4. "single_choice": Radio button/dropdown (required: "options": [ { "id": "opt-1", "label": "Text", "value": "val" }, ... ], optional: "allowOther": boolean)
    5. "multiple_choice": Checkboxes (required: "options": [ ... ], optional: "minSelections", "maxSelections", "allowOther": boolean)
    6. "rating": Rating scale (rules: "maxRating": 5 or 10, "ratingShape": "STAR" | "NUMBER" | "HEART")
    7. "linear_scale": Likert scale (rules: "min": 1, "max": 5 or 7 or 10, "minLabel": "Disagree", "maxLabel": "Agree", "step": 1)
    8. "date": Date picker (optional: "includeTime": false)
    9. "file_upload": File attachment (rules: "maxFileSizeMb": 10, "maxFiles": 1, "allowedMimeTypes": ["image/png", "image/jpeg", "application/pdf"])
${preferencesSection}
Ensure question wording is unbiased, logical, and flows naturally from broad to specific.`;
  }
}
