/** Reads a pair of coordinates from what people paste out of Google Maps: "7.3990014, 3.9411920", "7.399 3.941", a maps URL with @lat,lng or !3d..!4d.. */
export function parseCoordinates(input: string): { lat: number; lng: number } | { error: string } {
  const s = input.trim();
  if (!s) return { error: 'Paste the coordinates from Google Maps, for example 7.3990014, 3.9411920.' };
  const patterns = [/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /(?:^|[^\d.-])(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)(?:[^\d.]|$)/];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (!(lat >= -90 && lat <= 90)) return { error: 'The first number (latitude) must be between -90 and 90.' };
    if (!(lng >= -180 && lng <= 180)) return { error: 'The second number (longitude) must be between -180 and 180.' };
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }
  return { error: 'Could not find two numbers. Right-click the place in Google Maps and click the coordinates to copy them, for example 7.3990014, 3.9411920.' };
}

export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
