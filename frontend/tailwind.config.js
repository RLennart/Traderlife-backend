/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        buy: "#22c55e",
        sell: "#ef4444",
        hold: "#f59e0b",
      },
    },
  },
  plugins: [],
};
