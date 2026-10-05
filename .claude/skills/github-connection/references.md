# GitHub Connection — references

## Sources
- gh manual: https://cli.github.com/manual/ (`gh pr list`, `gh pr view`, `gh pr diff`, `gh pr checks`, `gh repo view`, `gh api`)
- GitHub REST: search issues/PRs https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests · PR review comments https://docs.github.com/en/rest/pulls/comments · repo contents https://docs.github.com/en/rest/repos/contents
- DevDigest MCP: `mcp/README.md`, `mcp/specs/tools-contract.md` (tool contracts), `docs/plans/2026-10-04-devdigest-mcp.md`
- Plan of this skill: `docs/plans/2026-10-04-github-connection-skill.md`

## Verify on this machine (the skill was written without running gh)
Run once with your own `gh` (read-only):
```
gh --version && gh auth status
gh repo view AlenkaNahorna/filmoteka-team-project --json nameWithOwner,description,defaultBranchRef,isPrivate,pushedAt,stargazerCount,url
gh pr list -R AlenkaNahorna/filmoteka-team-project --state all --limit 5 --json number,title,state,author,createdAt,updatedAt,headRefName,baseRefName,isDraft,url
gh api "search/issues?q=repo:AlenkaNahorna/filmoteka-team-project+type:pr+state:open" --jq .total_count
gh pr view <N> -R AlenkaNahorna/filmoteka-team-project --json title,state,files,reviewDecision,changedFiles
```
If a command rejects a field, fix the table in `SKILL.md` (run `gh pr view --json` to list valid fields).

## Related
- Enforcement beats guidance: to hard-limit `gh`, add permission rules in `.claude/settings.json` (allow `Bash(gh pr list:*)`, `Bash(gh pr view:*)`, `Bash(gh repo view:*)`, `Bash(gh pr diff:*)`, `Bash(gh pr checks:*)`; ask for everything else).
