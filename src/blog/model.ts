import {
    PUBLISH_DEFAULTS,
    type PublishingConfig,
    CONFIG_FILE,
} from "./publishing";
export interface BlogSettings {
    websitePath: string;
    nodePath: string;
    repository: string;
    account: string;
    blogUrl: string;
}
export const BLOG_DEFAULTS: BlogSettings = {
    websitePath: "",
    nodePath: "/opt/homebrew/bin/node",
    repository: "SonghaiFan/knowledge",
    account: "SonghaiFan",
    blogUrl: "https://blog.songhai.site",
};
export function articleUrl(
    file: string,
    slug: unknown,
    base: string,
    rules: PublishingConfig = PUBLISH_DEFAULTS
): string {
    const folders = [
        [rules.publicFolder, false, false],
        [`${rules.publicFolder}/${rules.englishFolder}`, true, false],
        [`${rules.publicFolder}/${rules.projectsFolder}`, false, true],
        [
            `${rules.publicFolder}/${rules.englishFolder}/${rules.projectsFolder}`,
            true,
            true,
        ],
    ] as const;
    const match = folders.find(
        ([folder]) =>
            file.startsWith(folder + "/") &&
            !file.slice(folder.length + 1).includes("/") &&
            file.endsWith(".md")
    );
    if (!match) throw new Error("请打开配置的公开目录中的文章。");
    const [, en, project] = match;
    const key = project ? file.split("/").pop()!.slice(0, -3) : slug;
    if (
        typeof key !== "string" ||
        (!project && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key))
    )
        throw new Error("普通文章需要稳定的小写英文 slug。");
    const url = new URL(
        `${en ? "/" : "/zh/"}${project ? "projects/" : "blog/posts/"}${encodeURIComponent(key)}`,
        base
    );
    if (!/^https?:$/.test(url.protocol))
        throw new Error("博客网址必须使用 HTTP(S)。");
    return url.href;
}
export function publicChanges(
    paths: string[],
    rules: PublishingConfig = PUBLISH_DEFAULTS
): boolean {
    return paths.some(
        (p) =>
            p === CONFIG_FILE ||
            p.startsWith(rules.publicFolder + "/") ||
            p.startsWith(rules.assetsFolder + "/")
    );
}
