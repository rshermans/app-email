/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172126",
        mist: "#f4f7f6",
        pine: "#0f766e",
        coral: "#d85f4f",
        amberline: "#d89d24"
      },
      boxShadow: {
        soft: "0 14px 42px rgba(23, 33, 38, 0.10)"
      }
    }
  },
  plugins: []
};
