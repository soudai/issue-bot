const core = require('@actions/core');
const github = require('@actions/github');
const Handlebars = require('handlebars');
const yaml = require('js-yaml');

const token = process.env.GITHUB_TOKEN;
const octokit = github.getOctokit(token);
const context = github.context;

// Is issue with issueId already pinned to this repo?
const isPinned = async issueId => {
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
};

// Given a GraphQL issue id, unpin the issue
const unpin = async issueId => {
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
};

// Given a GraphQL issue id, pin the issue
const pin = issueId => {
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
};

// Return issue body, plus the metadata header if from a standard issue template
const getTemplateFromFile = async (templateFilePath) => {
    if (!templateFilePath) {
        return;
    }

    let template = '';
    let metadata = {};

    core.debug(`Getting contents of: ${templateFilePath}`);

    // Get contents of template file
    try {
        template = (await octokit.repos.getContent({
            ...github.context.repo,
            path: templateFilePath,
            mediaType: {
                format: 'raw'
            }
        })).data;
    } catch (error) {
        core.error(`Error encountered retrieving issue template: ${error}`);
    }

    core.debug(`template: ${template}`);

    // Does this issue template have a YAML header at the top
    const hasHeader = template.slice(0, 3) === '---';

    if (hasHeader) {
        // Get header, which is formatted as YAML key/values
        const header = yaml.safeLoad(template.split('---')[1].trim());

        core.debug(`header: ${header}`);

        metadata = {
            assignees: header.assignees || '',
            labels: header.labels || '',
            title: header.title || ''
        };

        // Assume if none of these are set, it's just a normal HR ¯\_(ツ)_/¯
        // https://github.com/imjohnbo/issue-bot/issues/14
        if (metadata.assignees || metadata.labels || metadata.title) {
            // remove unnecessary YAML metadata found at the top of issue templates
            // https://help.github.com/en/github/building-a-strong-community/about-issue-and-pull-request-templates#issue-templates
            template = template.split('---').slice(2).join('---').trim();
        }
    }

    return {
        template: template || '',
        metadata: metadata || {}
    };
};

// labels: ['label1', 'label2']
const getLatestIssue = async (labels) => {
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
        .forEach(issue => )

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

export async function run() {
    try {
        const labels = core.getInput('labels');
        const project = core.getInput('project');
        const milestone = core.getInput('milestone');
        const title = core.getInput('title');
        const assignees = core.getInput('assignees');
        const rotateAssignees = core.getInput('rotate-assignees') === 'true';
        let body = core.getInput('body');
        const templateFile = core.getInput('template');
        const pinned = core.getInput('pinned') === 'true';
        const closePrevious = core.getInput('close-previous') === 'true';
        const linkedComments = core.getInput('linked-comments') === 'true';
        let previousAssignee;
        let template = '';
        let metadata = {};

        if (templateFile) {
            ({ template, metadata } = await getTemplateFromFile(templateFile));
        }

        // Give precedence to assignees, labels, and title inputs; fall back to values from template file
        metadata.assignees = assignees || metadata.assignees || '';
        metadata.labels = labels || metadata.labels || '';
        metadata.title = title || metadata.title || '';
        body = body || template;

        core.debug(`metadata: ${JSON.stringify(metadata)}`);

        // Title is a required field, either from an input or a template
        if (!metadata.title) {
            throw Error('Title must be supplied in issue template or as an input.');
        }

        // Labels is a required field, either from an input or a template
        if (!metadata.labels) {
            throw Error('Labels must be supplied in issue template or as an input.');
        }

        // Format data for API call
        metadata.assignees = metadata.assignees.split(',').map(s => s.trim()); // 'user1, user2' --> ['user1', 'user2']
        metadata.labels = metadata.labels.split(',').map(s => s.trim()); // 'label1, label2' --> ['label1', 'label2']

        const { previousIssueNumber, previousIssueId, previousAssignees } = await getLatestIssue(metadata.labels);

        if (previousIssueNumber >= 0) {
            previousAssignee = previousAssignees.nodes.length ? previousAssignees.nodes[0].login : undefined;
        }

        core.debug(`Previous issue number: ${previousIssueNumber}`);
        core.debug(`Previous issue assignee: ${previousAssignee}`);

        // Render body with previousIssueNumber
        body = Handlebars.compile(body)({ previousIssueNumber });

        // Rotate assignee to next in list?
        if (rotateAssignees) {
            const index = (metadata.assignees.indexOf(previousAssignee) + 1) % metadata.assignees.length;

            // Reset array of assignees to single assignee, next in list
            metadata.assignees = [metadata.assignees[index]];
        }

        // Create a new issue
        const { data: { number: newIssueNumber } } = await octokit.issues.create({
            ...github.context.repo,
            title: metadata.title,
            labels: metadata.labels,
            assignees: metadata.assignees,
            body
        }) || {};

        core.debug(`New issue number: ${newIssueNumber}`);

        // Write comments linking the current and previous issue
        if (+previousIssueNumber >= 0 && linkedComments) {
            // Create comment on the previous that points to the new
            await octokit.issues.createComment({
                ...github.context.repo,
                issue_number: previousIssueNumber,
                body: `Next: #${newIssueNumber}`
            });
        }

        const repositoryByNumberQuery = `{
      resource(url: "${context.repo}") {
        ... on Repository {
          issue(number: ${newIssueNumber}){
            id
          }
        }
      }
    }`;

        // Query to get the GraphQL id (ex. MDX6SXMzbWU0ODAxNzI0NDA=) of the new issue that we have the number of
        const { id: newRadarId } = (await octokit.graphql(
            repositoryByNumberQuery
        )).resource.issue || {};

        // If there is a previous issue, close it out and point to the new
        if (+previousIssueNumber >= 0 && closePrevious) {
            core.debug(`Closing issue number ${previousIssueNumber}...`);

            // Close out the previous
            await octokit.issues.update({
                ...github.context.repo,
                issue_number: previousIssueNumber,
                state: 'closed'
            });

            // If the pinned input is true, pin the current, unpin the previous
            if (pinned) {
                await unpin(previousIssueId);
                await pin(newRadarId);
            }
        }

        if (newIssueNumber) {
            core.setOutput('issue-number', String(newIssueNumber));
        }
    } catch (error) {
        core.setFailed(`Error encountered: ${error}.`);
    }
}
