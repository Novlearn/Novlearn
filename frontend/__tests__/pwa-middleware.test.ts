import { expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "../middleware";

it.each(["/manifest.json", "/manifest.json?version=2", "/offline.html", "/sw.js", "/api/exercises"])(
  "serves the public asset or API %s without the page authentication redirect",
  (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `https://staging.novlearn.fr${path}` })).toBe(false);
  },
);

it.each(["/exercices?id=8", "/entrainement", "/progression", "/offline.html/private", "/manifest.json/private"])(
  "keeps page authentication for %s",
  (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: `https://staging.novlearn.fr${path}` })).toBe(true);
  },
);
