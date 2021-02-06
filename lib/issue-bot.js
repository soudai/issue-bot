//@ts-check
const core = require('@actions/core');
const github = require('@actions/github');
const Handlebars = require('handlebars');
import * as issues from './issue';

const token = process.env.GITHUB_TOKEN;
const octokit = github.getOctokit(token);
const context = github.context;

function needPreviousIssue(...conditions) {
    return conditions.includes(true);
}

export function checkInputs(inputs) {
    let ok = true;

    ok = inputs.title ? true : false;
    ok = inputs.pinned && inputs.labels ? true : false;
    ok = inputs.closePrevious && inputs.labels ? true : false;
    ok = inputs.linkedComments && inputs.labels ? true : false;
    ok = inputs.rotateAssignees && inputs.labels && inputs.assignees ? true : false;

    return ok;
}

export function getNextAssignee(assignees, previousAssignee) {
    const index = (assignees.indexOf(previousAssignee) + 1) % assignees.length;
    return [assignees[index]];
}

export async function createNewIssue(options, body) {
    const { data: { number: newIssueNumber } } = (await octokit.issues.create({
        ...context.repo,
        title: options.title,
        labels: options.labels,
        assignees: options.assignees,
        body
    })) || {};

    return Number(newIssueNumber);
}

export async function closeIssue(issueNumber) {
    return await octokit.issues.update({
        ...context.repo,
        issue_number: issueNumber,
        state: 'closed'
    });
}

export async function makeLinkedComments(newIssueNumber, previousIssueNumber) {
    // Create comment on the new that points to the previous
    await octokit.issues.createComment({
        ...context.repo,
        issue_number: newIssueNumber,
        body: `Previous in series: #${previousIssueNumber}`
    });

    // Create comment on the previous that points to the new
    await octokit.issues.createComment({
        ...github.context.repo,
        issue_number: previousIssueNumber,
        body: `Next in series: #${newIssueNumber}`
    });
}

export async function getNewIssueId(number) {
    const repositoryByNumberQuery = `{
        resource(url: "${context.repo}") {
            ... on Repository {
            issue(number: ${number}){
                id
            }
            }
        }
    }`;

    // Query to get the GraphQL id of the new issue that we have the number of
    const { id: newIssueId } = (await octokit.graphql(
        repositoryByNumberQuery
    )).resource.issue || {};

    return newIssueId;
}

export function issueExists(previousIssueNumber) {
    return previousIssueNumber >= 0;
}

// Return previous issue matching both labels
// @input labels: ['label1', 'label2']
export async function getPreviousIssue(labels) {
    core.debug(`Finding previous issue with labels: ${JSON.stringify(labels)}...`);

    const data = (await octokit.issues.listForRepo({
        ...context.repo,
        labels
    })).data[0];

    const previousIssueNumber = data.number;
    const previousIssueId = data.id;
    const previousAssignees = data.assignees;

    core.debug(`Previous issue number: ${previousIssueNumber}`);

    return {
        previousIssueNumber: Number(previousIssueNumber),
        previousIssueId,
        previousAssignees
    }
}

export async function run(inputs) {
    try {
        const {
            title,
            body,
            labels,
            assignees,
            project,
            column,
            milestone,
            pinned,
            closePrevious,
            rotateAssignees,
            linkedComments
        } = inputs;
        let previousAssignee, previousIssueNumber, previousIssueId, previousAssignees;
        let nextAssignee;

        if (needPreviousIssue(pinned, closePrevious, rotateAssignees, linkedComments)) {
            ({ previousIssueNumber, previousIssueId, previousAssignees } = await getPreviousIssue(labels));
        }

        if (issueExists(previousIssueNumber)) {
            previousAssignee = previousAssignees.length ? previousAssignees[0].login : undefined;
        }

        const renderedBody = Handlebars.compile(body)({ previousIssueNumber, assignees });
        const newIssueNumber = await createNewIssue(inputs, renderedBody);

        core.debug(`New issue number: ${newIssueNumber}`);

        // Rotate assignee to next in list
        if (rotateAssignees) {
            nextAssignee = getNextAssignee(assignees, previousAssignee);
        }

        // Write comments linking the current and previous issue
        if (previousIssueNumber >= 0 && linkedComments) {
            await makeLinkedComments(newIssueNumber, previousIssueNumber);
        }

        // If there is a previous issue, close it out and point to the new
        if (previousIssueNumber >= 0 && closePrevious) {
            core.debug(`Closing issue number ${previousIssueNumber}...`);

            // Close out the previous
            await closeIssue(previousIssueNumber);

            const newIssueId = await getNewIssueId(newIssueNumber);

            // If the pinned input is true, pin the current, unpin the previous
            if (pinned) {
                await issues.unpin(previousIssueId);
                await issues.pin(newIssueId);
            }
        }

        if (newIssueNumber) {
            core.debug(`New issue number: ${newIssueNumber}`);
            core.setOutput('issue-number', String(newIssueNumber));
        }
    } catch (error) {
        core.setFailed(`Error encountered: ${error}.`);
    }
}
