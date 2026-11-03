# dazzer-io shared workflows

The checks every gated dazzer-io repository runs through the organisation ruleset: the AI review, the engineer review and the security scan. Built by the SOC 2 readiness job.

`test-times/` is the shared test-time recorder. It keeps each test's and test file's time on every run, kept with the run on GitHub, and reads those records back for the planners and the weekly reading. Its README says how a repository wires it in.
