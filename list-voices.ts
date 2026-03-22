import dotenv from "dotenv";
dotenv.config();

async function list() {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY || "" },
  });
  if (!response.ok) {
    console.log("Error:", response.status, await response.text());
    return;
  }
  const data = await response.json();
  data.voices.forEach(v => console.log(`NAME: ${v.name} | ID: ${v.voice_id}`));
}
list();
