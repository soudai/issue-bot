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
    core.debug(`Creating new issue with options: ${JSON.stringify(options)} and body: ${body}`);

    const { data: { number: newIssueNumber, id: newIssueId, node_id: newIssueNodeId } } = (await octokit.issues.create({
        ...context.repo,
        title: options.title,
        labels: options.labels,
        assignees: options.assignees,
        body
    })) || {};

    core.debug(`New issue number: ${newIssueNumber}`);
    core.debug(`New issue id: ${newIssueId}`);
    core.debug(`New issue node ID: ${newIssueNodeId}`);

    return {
        newIssueNumber: Number(newIssueNumber),
        newIssueId,
        newIssueNodeId
    };
}

export async function closeIssue(issueNumber) {
    core.debug(`Closing issue number ${issueNumber}...`);

    return await octokit.issues.update({
        ...context.repo,
        issue_number: issueNumber,
        state: 'closed'
    });
}

export async function makeLinkedComments(newIssueNumber, previousIssueNumber) {
    core.debug(`Making linked comments on new issue number ${newIssueNumber} and previous issue number ${previousIssueNumber}`);

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
    const previousIssueNodeId = data.node_id;
    const previousAssignees = data.assignees;

    core.debug(`Previous issue number: ${previousIssueNumber}`);

    return {
        previousIssueNumber: previousIssueNumber ? Number(previousIssueNumber) : undefined,
        previousIssueNodeId,
        previousAssignees
    }
}

export async function addIssueToProjectColumn(issueId, projectId, columnName) {
    core.debug(`Adding issue id ${issueId} to project id ${projectId}, column name ${columnName}`);

    const { data: columns } = await octokit.projects.listColumns({
        project_id: projectId,
    });

    const column = columns.find(column => column.name === columnName);

    if (!column) {
        throw new Error(`Column with name ${columnName} could not be found in repository project with id ${projectId}.`);
    }

    await octokit.projects.createCard({
        column_id: column.id,
        content_id: issueId,
        content_type: 'Issue',
    });
}

export async function addIssueToMilestone(issueNumber, milestoneNumber) {
    await octokit.issues.update({
        ...context.repo,
        issue_number: issueNumber,
        milestone: milestoneNumber
    });
}

/**
 * Takes provided inputs, acts on them, and produces a single output
 * @param {object} inputs 
 */
export async function run(inputs) {
    try {
        /** See action.yml for input description */
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
            linkedComments,
            rotateAssignees
        } = inputs;
        let previousAssignee, previousIssueNumber, previousIssueNodeId, previousAssignees;

        if (needPreviousIssue(pinned, closePrevious, rotateAssignees, linkedComments)) {
            ({ previousIssueNumber, previousIssueNodeId, previousAssignees } = await getPreviousIssue(labels));
        }

        if (issueExists(previousIssueNumber)) {
            previousAssignee = previousAssignees.length ? previousAssignees[0].login : undefined;
        }

        // Rotate assignee to next in list
        if (rotateAssignees) {
            inputs.assignees = getNextAssignee(assignees, previousAssignee);
        }

        const renderedBody = Handlebars.compile(body)({ previousIssueNumber, assignees });
        const { newIssueNumber, newIssueId, newIssueNodeId } = await createNewIssue(inputs, renderedBody);

        if (project && column) {
            await addIssueToProjectColumn(newIssueId, project, column)
        }

        if (milestone) {
            await addIssueToMilestone(newIssueNumber, milestone)
        }

        // Write comments linking the current and previous issue
        if (issueExists(previousIssueNumber) && linkedComments) {
            await makeLinkedComments(newIssueNumber, previousIssueNumber);
        }

        // If there is a previous issue, close it out and point to the new
        if (issueExists(previousIssueNumber) && closePrevious) {
            await closeIssue(previousIssueNumber);

            // If the pinned input is true, pin the current, unpin the previous
            if (pinned) {
                await issues.unpin(previousIssueNodeId);
                await issues.pin(newIssueNodeId);
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
