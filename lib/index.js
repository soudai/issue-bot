const core = require('@actions/core');
import { run, checkInputs } from './issue-bot';

if (require.main === module) {
  try {
    const inputs = {
      title: core.getInput('title'),
      body: core.getInput('body'),
      labels: core.getInput('labels').split(',').map(s => s.trim()),
      assignees: core.getInput('assignees').split(',').map(s => s.trim()),
      project: core.getInput('project'),
      column: core.getInput('column'),
      milestone: core.getInput('milestone'),
      pinned: core.getInput('pinned') === 'true',
      closePrevious: core.getInput('close-previous') === 'true',
      rotateAssignees: core.getInput('rotate-assignees') === 'true',
      linkedComments: core.getInput('linked-comments') === 'true'
    }
  
    checkInputs(inputs);
    run(inputs);
  }
  catch (error) {
    core.error(error);
  }
}