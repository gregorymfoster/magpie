# Magpie bench

Generated 2026-10-27T20:04:58.557Z. "ready" means a reader would see a good book: no Kindle-critical errors (our guess at the list, pending the email test), the right cover declared, correct title, author and language, every chapter in order, a clean layout (scene breaks kept, no spacer paragraphs, typed indents or publisher body-text CSS) and every paragraph of the input still there letter for letter ("text"). "fixed" is ready plus zero EPUBCheck errors.

### Broken files, held-out books (the number that counts) (60 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| fixed | 0% | 7% | 7% | 100% |
| ready | 2% | 30% | 30% | 100% |
| strict | 18% | 23% | 23% | 100% |
| kindle | 27% | 82% | 82% | 100% |
| cover | 45% | 100% | 100% | 100% |
| metadata | 50% | 63% | 63% | 100% |
| content | 68% | 88% | 88% | 100% |
| layout | 55% | 72% | 72% | 100% |
| text | 100% | 87% | 87% | 100% |

### Broken files, tuning books (240 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| fixed | 0% | 8% | 10% | 100% |
| ready | 3% | 32% | 32% | 100% |
| strict | 16% | 25% | 30% | 100% |
| kindle | 27% | 86% | 86% | 100% |
| cover | 52% | 100% | 100% | 100% |
| metadata | 60% | 68% | 68% | 100% |
| content | 78% | 89% | 89% | 100% |
| layout | 61% | 71% | 71% | 100% |
| text | 100% | 89% | 89% | 100% |

### Clean files (should stay clean: anything below 100% is a regression) (60 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| fixed | 67% | 33% | 33% | 100% |
| ready | 67% | 100% | 100% | 100% |
| strict | 100% | 33% | 33% | 100% |
| kindle | 100% | 100% | 100% | 100% |
| cover | 67% | 100% | 100% | 100% |
| metadata | 100% | 100% | 100% | 100% |
| content | 100% | 100% | 100% | 100% |
| layout | 100% | 100% | 100% | 100% |
| text | 100% | 100% | 100% | 100% |

### Real-world files (no ground truth; EPUBCheck and text only) (8 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| strict | 13% | 75% | 75% | 100% |
| kindle | 13% | 100% | 75% | 100% |
| text | 100% | 100% | 100% | 100% |

### Clean rate (Magpie: no to-dos and no suggestions left)

| files | n | as imported | after accepting suggestions |
|---|---|---|---|
| Clean twins | 60 | 100% | 100% |
| Broken, held-out | 60 | 70% | 100% |
| Broken, tuning | 240 | 74% | 100% |
| Real-world | 8 | 38% | 38% |

### Fixed rate by defect category (all broken files, single-defect copies only)

| category | n | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|---|
| container_missing | 2 | 0% | 0% | 0% | 100% |
| container_wrong_path | 2 | 0% | 0% | 0% | 100% |
| cover_undeclared | 2 | 0% | 100% | 100% | 100% |
| cover_wrong_id | 2 | 0% | 0% | 0% | 100% |
| duplicate_ids | 1 | 0% | 100% | 100% | 100% |
| encoding_cp1252 | 2 | 0% | 0% | 0% | 100% |
| font_corrupt | 2 | 0% | 0% | 0% | 100% |
| href_spaces | 2 | 0% | 0% | 0% | 100% |
| layout_blank_scene_breaks | 1 | 0% | 0% | 0% | 100% |
| layout_body_css | 1 | 0% | 0% | 0% | 100% |
| layout_chapter_title_p | 1 | 0% | 0% | 0% | 100% |
| layout_nbsp_indent | 1 | 0% | 0% | 0% | 100% |
| layout_spacer_paragraphs | 1 | 0% | 0% | 0% | 100% |
| manifest_missing_file | 2 | 0% | 100% | 100% | 100% |
| manifest_unlisted_file | 2 | 0% | 0% | 0% | 100% |
| media_type_wrong | 2 | 0% | 0% | 0% | 100% |
| meta_filename_title | 2 | 0% | 0% | 0% | 100% |
| meta_no_author | 2 | 0% | 0% | 0% | 100% |
| meta_no_language | 2 | 0% | 0% | 0% | 100% |
| meta_no_modified | 2 | 0% | 0% | 0% | 100% |
| meta_no_title | 2 | 0% | 0% | 0% | 100% |
| meta_uid_mismatch | 2 | 0% | 0% | 0% | 100% |
| meta_unknown_author | 2 | 0% | 0% | 0% | 100% |
| mimetype_compressed | 2 | 0% | 0% | 0% | 100% |
| mimetype_missing | 2 | 0% | 100% | 100% | 100% |
| mimetype_not_first | 2 | 0% | 0% | 0% | 100% |
| mimetype_trailing_newline | 2 | 0% | 100% | 100% | 100% |
| spine_bad_idref | 2 | 0% | 0% | 0% | 100% |
| toc_nav_missing | 2 | 0% | 0% | 100% | 100% |
| toc_ncx_broken | 2 | 0% | 100% | 100% | 100% |
| xhtml_html_entities | 2 | 0% | 100% | 100% | 100% |
| xhtml_tag_soup | 2 | 0% | 0% | 0% | 100% |
| xhtml_unclosed_tags | 2 | 0% | 0% | 0% | 100% |

### Magpie runtime

Median 60 ms per book. 0 crash(es).

### Magpie misses (0)

