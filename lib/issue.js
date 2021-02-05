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

// labels: ['label1', 'label2']
export async function getLatestIssue(labels) {
    // GraphQL query to get latest matching open issue, if it exists, along with first assignee
    const latestWithLabel = (label) => `{
        resource(url: "${context.repo}") {
            ... on Repository {
            issues(last:1, labels:${label}, states:[OPEN]) {
                nodes {
                    number
                    id
                    assignees (first: 1) {
                        nodes {
                            login
                        }
                    }
                }
            }}
        }
    }`;

    const issuesMatchingLabels = (await Promise.all(labels.map(async label =>
        (await octokit.graphql(latestWithLabel(label))).resource.issues.nodes[0] || {}
    )));

    issuesMatchingLabels
        .sort((a, b) => b.number - a.number)
        .forEach(issue => console.log)

        // // Run the query, save the number (ex. 79) and GraphQL id (ex. MDU6SXMzbWU0ODAxNzI0NDA=)
        // const {
        //     number: previousIssueNumber,
        //     id: previousIssueId,
        //     assignees: previousAssignees
        // } = (await octokit.graphql(latestIssueQuery)).resource.issues.nodes[0] || {};

        return {
        previousIssueNumber,
        previousIssueId,
        previousAssignees
    }
}