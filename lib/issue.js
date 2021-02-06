const yaml = require('js-yaml');

// Is issue with issueId already pinned to this repo?
export async function isPinned(issueId) {
  const query = `{
    resource(url: "${context.repo}") {
      ... on Repository {
        pinnedIssues(last: 3) {
          nodes {
            issue {
              id
            }
          }
        }
      }
    }
  }`;
  const data = await octokit.graphql({
    query,
    headers: {
      accept: 'application/vnd.github.elektra-preview+json'
    }
  });
  const pinnedIssues = data.resource.pinnedIssues.nodes || [];
  return pinnedIssues.findIndex(pinnedIssue => pinnedIssue.issue.id === issueId) >= 0;
}

// Given a GraphQL issue id, unpin the issue
export async function unpin(issueId) {
  core.debug(`Check if ${issueId} is already pinned...`);

  if (!(await isPinned(issueId))) {
    return;
  }

  core.debug(`Unpinning ${issueId}...`);

  const mutation = `mutation {
    unpinIssue(input: {issueId: "${issueId}"}) {
      issue {
        body
      }
    }
  }`;

  return octokit.graphql({
    query: mutation,
    headers: {
      accept: 'application/vnd.github.elektra-preview+json'
    }
  });
}

// Given a GraphQL issue id, pin the issue
export function pin(issueId) {
  core.debug(`Pinning ${issueId}...`);

  const mutation = `mutation {
    pinIssue(input: {issueId: "${issueId}"}) {
        issue {
          body
        }
      }
    }`;
  return octokit.graphql({
    query: mutation,
    headers: {
      accept: 'application/vnd.github.elektra-preview+json'
    }
  });
}