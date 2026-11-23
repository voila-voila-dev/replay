// Stars are read from GitHub at build time; the collection value is the fallback
// when the API is rate-limited or unreachable.
export async function starsOf(repo: string, fallback: number): Promise<number> {
	try {
		const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
		if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		const response = await fetch(`https://api.github.com/repos/${repo}`, { headers });
		if (!response.ok) return fallback;
		const body = (await response.json()) as { stargazers_count?: number };
		return body.stargazers_count ?? fallback;
	} catch {
		return fallback;
	}
}
