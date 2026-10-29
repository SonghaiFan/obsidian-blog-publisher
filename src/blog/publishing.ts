import * as fs from "fs";
import * as path from "path";
export const CONFIG_FILE = ".blog-publisher.json";
export const PUBLISH_DEFAULTS = {
    publicFolder: "Blog",
    englishFolder: "en",
    projectsFolder: "projects",
    assetsFolder: "assets",
    privateFolders: ["Daily", "Notes"],
};
export type PublishingConfig = typeof PUBLISH_DEFAULTS;
export function validatePublishing(
    input: Partial<PublishingConfig>
): PublishingConfig {
    const c = { ...PUBLISH_DEFAULTS, ...input };
    const folder = (v: string) => {
        // Control characters are invalid in user-configured filesystem paths.
        if (
            typeof v !== "string" ||
            !v ||
            v !== v.trim() ||
            v.split("/").some(
                (p) =>
                    !p ||
                    p.startsWith(".") ||
                    // eslint-disable-next-line no-control-regex
                    /[\\:*?"<>|\x00-\x1f]/.test(p)
            )
        )
            throw new Error(
                "目录须为知识库内的相对路径，不能包含隐藏目录或 ..。"
            );
    };
    [c.publicFolder, c.englishFolder, c.projectsFolder, c.assetsFolder].forEach(
        folder
    );
    if (!Array.isArray(c.privateFolders)) throw new Error("私人目录须为列表。");
    c.privateFolders.forEach(folder);
    const overlaps = (a: string, b: string) =>
        a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    const roots = [c.publicFolder, c.assetsFolder, ...c.privateFolders];
    if (
        roots.some((a, i) => roots.slice(i + 1).some((b) => overlaps(a, b))) ||
        overlaps(c.englishFolder, c.projectsFolder)
    )
        throw new Error(
            "公开、附件和私人目录不能重叠；英文和项目子目录不能重叠。"
        );
    return c;
}
export function readPublishing(root: string): PublishingConfig {
    const file = path.join(root, CONFIG_FILE);
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
        throw new Error("配置文件不能是符号链接。");
    return validatePublishing(
        fs.existsSync(file)
            ? (JSON.parse(fs.readFileSync(file, "utf8")) as PublishingConfig)
            : {}
    );
}
