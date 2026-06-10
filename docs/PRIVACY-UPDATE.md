## Privacy policy updated

TinyTinkerer now routes all model requests through a self-hosted
[LiteLLM](https://docs.litellm.ai/docs/) proxy operated by the maintainer. Previously,
requests went to GitHub Models or OpenRouter using your own credentials; those providers
have been removed.

Your conversation content passes through this proxy to the model providers the maintainer
has configured, in order to generate responses. The proxy does not store your messages: it
records only operational metadata per request (model, token counts, cost, timing, and
success/error status), which the maintainer can view in the LiteLLM dashboard to monitor
usage and reliability. Model requests are sent with a shared service credential and are
not linked to your GitHub identity.

GitHub sign-in is now used only for access control — verifying that you hold a valid
GitHub token before requests are forwarded. Personal access tokens and user-supplied
provider API keys are no longer used. See the new "Chat content and the model proxy
(LiteLLM)" section of the privacy policy for details.
