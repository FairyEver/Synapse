#!/bin/bash

# Fix content-submission-service.ts
sed -i '' '40,92d' electron/services/content-submission-service.ts
sed -i '' '/^import { createMainLogger } from "\.\.\/.log-store"$/a\
import { formatGitFailureMessage } from "./git-error-utils"' electron/services/content-submission-service.ts

# Fix repository-git-service.ts (lines 131-186, different signature)
sed -i '' '131,186d' electron/services/repository-git-service.ts
sed -i '' 's/formatFailureMessage: (output) => formatGitFailureMessage(output)/formatFailureMessage: formatGitFailureMessage/' electron/services/repository-git-service.ts
sed -i '' '/^import { createMainLogger } from "\.\.\/.log-store"$/a\
import { formatGitFailureMessage } from "./git-error-utils"' electron/services/repository-git-service.ts

# Fix repository-maintenance-service.ts (lines 133-177)
sed -i '' '133,177d' electron/services/repository-maintenance-service.ts
sed -i '' '/^import { createMainLogger } from "\.\.\/.log-store"$/a\
import { formatGitFailureMessage } from "./git-error-utils"' electron/services/repository-maintenance-service.ts

# Fix repository-structure-service.ts (lines 92-108)
sed -i '' '92,108d' electron/services/repository-structure-service.ts
sed -i '' '/^import { createMainLogger } from "\.\.\/.log-store"$/a\
import { formatGitFailureMessage } from "./git-error-utils"' electron/services/repository-structure-service.ts

# Fix user-profile-service.ts (lines 38-54)
sed -i '' '38,54d' electron/services/user-profile-service.ts
sed -i '' '/^import { createMainLogger } from "\.\.\/.log-store"$/a\
import { formatGitFailureMessage } from "./git-error-utils"' electron/services/user-profile-service.ts

echo "Done"
