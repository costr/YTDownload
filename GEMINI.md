# project Mandates for Gemini CLI

These rules take absolute precedence over any other general instructions or workflows.

### 1. Strict Git Protocol
NEVER stage, commit, or push code unless the user explicitly uses the word "push" or "commit". Fulfill all implementation and testing steps, then wait for the user's directive to upload to GitHub.

### 2. Backend Restart Reminders
Every time the Python backend (`backend/main.py`) is modified, always include a reminder that the user needs to restart the backend process for the changes to take effect.

### 3. Dependency Verification
Before adding any new imports to the backend, check if the library is already installed in the virtual environment. If it is missing, install it using the local `pip` before modifying the code.

### 4. Styling Standards
Prefer **Vanilla CSS** in `App.css` for all new features. Avoid adding new CSS utility frameworks or excessive inline styles to maintain consistency with the established design.

### 5. Defensive Data Handling
When working with data from external sources (like `yt-dlp`), always use safe `.get()` calls and null-checks. Ensure the frontend never crashes due to unexpected or missing data fields from the YouTube API.

### 6. Security First
Never add packages or dependencies with known vulnerabilities. Maintain a high standard for system integrity.

### 7. Engineering Excellence
Always adhere to best coding standards, architectural patterns, and practices relevant to the language and framework being used (React/TypeScript/FastAPI).

### 8. DRY Principle
Keep the codebase "Don't Repeat Yourself" (DRY). Consolidate logic into clean, reusable abstractions rather than repeating code unless absolutely necessary for clarity or functionality.

### 9. Proactive Clarification
If a request is vague, ambiguous, or if more context would result in a better implementation, always ask for clarification before proceeding with changes.
