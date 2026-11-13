# Security

HQ listens on 127.0.0.1 only, reads what a project writes, and runs no code from it. A way around any of those is a security bug: a page another machine can reach, a request from a web page that makes HQ change something, a manifest or file that gets HQ to run code, or HQ reading a folder the manifest does not name.

## Reporting a vulnerability

Report it privately through GitHub's security advisories: on https://github.com/drewkhoury/homequarters, open the Security tab and choose "Report a vulnerability". Please do not open a public issue, pull request or discussion for it.

Say what you found, the version (`hq --version`), and the steps that show it. The reply comes on the advisory. Once a fix is released, the advisory is published with credit to you, unless you would rather not be named.

## Supported versions

Only the latest release gets security fixes.
