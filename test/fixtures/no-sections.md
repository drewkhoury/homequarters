# A file with a title and no sections

For tests/unit/hq-server.test.mjs: HQ's Code view gives a markdown file a section rail only when it has three or more
second- and third-level headings, and this file has none, so its page shows no rail and no sections button. It used to
lean on docs/sessions/README.md having no sections, which held only until someone gave that guide some.
