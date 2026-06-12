## Privacy policy updated

TinyTinkerer now routes all model requests through a self-hosted
[LiteLLM](https://docs.litellm.ai/docs/) proxy operated by the maintainer. Previously,
requests went to GitHub Models or OpenRouter using your own credentials; those providers
have been removed.

Your conversation content passes through this proxy to the model providers the maintainer
has configured, in order to generate responses. The proxy does not store your messages: it
records operational metadata per request (model, token counts, cost, timing, LiteLLM key
alias/user id, and success/error status), which the maintainer can view in the LiteLLM
dashboard to monitor usage, reliability, and per-account budgets.

GitHub sign-in is used for access control and per-user budgeting. The edge verifies that
you hold a valid GitHub token, reads the `id` and `login` fields from GitHub's `/user`
response, and provisions or reuses a LiteLLM virtual key for that GitHub account. Your
GitHub access token is not forwarded to LiteLLM or model providers. Personal access
tokens and user-supplied provider API keys are no longer used. See the new "Chat content
and the model proxy (LiteLLM)" section of the privacy policy for details.
