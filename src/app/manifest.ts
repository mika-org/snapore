import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Snapore Photobooth",
    short_name: "Snapore",
    description: "Offline-first photobooth capture and print kiosk.",
    start_url: "/kiosk",
    display: "standalone",
    background_color: "#161616",
    theme_color: "#ff604e",
    orientation: "any",
  };
}
