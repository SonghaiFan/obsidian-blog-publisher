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
export function articleUrl(file: string, slug: unknown, base: string): string {
    if (!/^Blog\/(?:en\/)?(?:projects\/)?[^/]+\.md$/.test(file))
        throw new Error("请打开 Blog 中的公开文章。");
    const en = file.startsWith("Blog/en/");
    const project = file.startsWith(
        en ? "Blog/en/projects/" : "Blog/projects/"
    );
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
export function publicChanges(paths: string[]): boolean {
    return paths.some((p) => p.startsWith("Blog/") || p.startsWith("assets/"));
}
