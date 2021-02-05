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
        
        // Get the previous issue if required
        if (needPreviousIssue(pinned, closePrevious, rotateAssignees, linkedComments)) {
            ({ previousIssueNumber, previousIssueId, previousAssignees } = await issues.getPreviousIssue(labels));

            core.debug(`Previous issue number: ${previousIssueNumber}`);
            core.debug(`Previous issue assignee: ${previousAssignee}`);
        }

        if (previousIssueNumber >= 0) {
            previousAssignee = previousAssignees.nodes.length ? previousAssignees.nodes[0].login : undefined;
        }

        // Render body with previousIssueNumber and assignees
        const renderedBody = Handlebars.compile(body)({ previousIssueNumber, assignees: assignees });

        // Create a new issue
        const { data: { number: newIssueNumber } } = await octokit.issues.create({
            ...github.context.repo,
            title: title,
            labels: labels,
            assignees: assignees,
            renderedBody
        }) || {};

        core.debug(`New issue number: ${newIssueNumber}`);

        // Rotate assignee to next in list?
        if (rotateAssignees) {
            const index = (assignees.indexOf(previousAssignee) + 1) % assignees.length;

            // Reset array of assignees to single assignee, next in list
            assignees = [assignees[index]];
        }

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
                await issues.unpin(previousIssueId);
                await issues.pin(newRadarId);
            }
        }

        if (newIssueNumber) {
            core.setOutput('issue-number', String(newIssueNumber));
        }
    } catch (error) {
        core.setFailed(`Error encountered: ${error}.`);
    }
}
