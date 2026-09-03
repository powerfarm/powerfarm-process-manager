import githubExtension from "@github-tools/eve-extension";
import {
  GITHUB_READ_TOOLS,
  githubInstallationToken,
  POWERFARM_PLANNING_OWNER,
  POWERFARM_PLANNING_REPO,
} from "#lib/github/config.js";

export default githubExtension({
  context: {
    owner: POWERFARM_PLANNING_OWNER,
    repo: POWERFARM_PLANNING_REPO,
  },
  include: [...GITHUB_READ_TOOLS],
  token: githubInstallationToken,
});
