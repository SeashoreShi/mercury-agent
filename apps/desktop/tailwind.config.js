import uiPreset from "../../ui/tailwind.config.js";

/** @type {import('tailwindcss').Config} */
export default {
  presets: [uiPreset],
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../ui/src/**/*.{ts,tsx}",
  ],
};
