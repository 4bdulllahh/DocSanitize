# Security policy

DocSanitize promises that files never leave the user's device and that removed content is really gone. Anything that breaks either promise is a security issue. Examples:

- a request to another origin, or any way for file contents to leave the browser;
- metadata left behind by Sanitize, or added to a file by any tool;
- redacted content that can still be recovered from the output;
- a weakness in Protect PDF's encryption;
- a way around the Content-Security-Policy.

## Reporting a vulnerability

Please report it privately through [GitHub's vulnerability reporting](https://github.com/4bdulllahh/DocSanitize/security/advisories/new), not in a public issue. Include the steps to reproduce and, if you can, a sample file.

You'll get a reply within a week. Once a fix is released, the advisory will be published with credit to you, unless you'd rather stay anonymous.

## Supported versions

Only the latest version on the `main` branch is supported. Self-hosted copies should be rebuilt from it to pick up fixes.
