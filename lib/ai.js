import OpenAI from 'openai';
import config from './config.js';

const openai = new OpenAI({ apiKey: config.openaiKey });

const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Parse text content using OpenAI chat completions with JSON mode.
 */
export async function parseWithAI(systemPrompt, userContent, options = {}) {
  const { model = DEFAULT_MODEL, temperature = 0.2 } = options;

  const response = await openai.chat.completions.create({
    model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Parse image content using OpenAI vision + JSON mode.
 */
export async function parseImageWithAI(systemPrompt, imageBuffer, mimeType, options = {}) {
  const { model = DEFAULT_MODEL, temperature = 0.2 } = options;

  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return JSON.parse(response.choices[0].message.content);
}
