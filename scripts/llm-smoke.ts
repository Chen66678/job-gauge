import { createLlmClient } from "../src/domain/llmClient";

const TEST_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAAAgCAIAAABiouoDAAAAeUlEQVR42u3Y0QnAIAxF0ey/dLtBwbYfVzxvAIVD0CRzyWMGASBAgABtCDQfsnD9zMZAL0/8CWjV+iygF8V4EFBHpwiU0skB1XRaQEGdEFBTpwKU1UkAlXVCQDppFeQN8ovpg3TSZjHTPKCYUXflWgcSQIAAAQKUzw1LXB3BiNd8mgAAAABJRU5ErkJggg==";

async function main() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    console.log("set DASHSCOPE_API_KEY to run live smoke");
    process.exit(0);
  }

  const client = createLlmClient({ apiKey });

  const textResult = await client.completeText({
    system: "Reply with a compact object only.",
    user: 'say ok in json with shape {"ok":true}',
    responseFormatJson: true
  });
  console.log("text result:");
  console.log(textResult);

  const visionResult = await client.completeVision({
    system: "Read the visible text in the image and reply with the extracted text only.",
    user: "Extract the visible text from this image.",
    imageBase64: TEST_IMAGE_BASE64,
    mimeType: "image/png"
  });
  console.log("vision result:");
  console.log(visionResult);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
