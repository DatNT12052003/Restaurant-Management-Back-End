import i18n from "i18next";
import Backend from "i18next-fs-backend";
import middleware from "i18next-http-middleware";
import path from "path";

i18n.use(Backend)
    .use(middleware.LanguageDetector)
    .init({
        fallbackLng: "en",
        preload: ["en", "vi"],
        ns: ["common", "validation", "auth", "account", "employee"],
        defaultNS: "common",
        backend: {
            loadPath: path.join(__dirname, "../locales/{{lng}}/{{ns}}.json"),
        },
        detection: {
            order: ["header", "querystring"],
            caches: false,
        },
    });

export default i18n;
