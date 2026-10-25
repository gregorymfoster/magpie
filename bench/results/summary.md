# Magpie bench

Generated 2026-10-25T18:13:43.360Z. "ready" means a reader would see a good book: no Kindle-critical errors (our guess at the list, pending the email test), the right cover declared, correct title, author and language, and every chapter in order. "fixed" is ready plus zero EPUBCheck errors.

### Broken files, held-out books (the number that counts) (48 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| fixed | 0% | 8% | 10% | 100% |
| ready | 4% | 60% | 60% | 100% |
| strict | 8% | 19% | 23% | 100% |
| kindle | 21% | 88% | 88% | 100% |
| cover | 46% | 100% | 100% | 100% |
| metadata | 56% | 73% | 73% | 100% |
| content | 77% | 94% | 94% | 100% |

### Broken files, tuning books (192 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| fixed | 2% | 15% | 19% | 100% |
| ready | 5% | 56% | 56% | 100% |
| strict | 12% | 24% | 31% | 100% |
| kindle | 26% | 85% | 85% | 100% |
| cover | 45% | 100% | 100% | 100% |
| metadata | 57% | 68% | 68% | 100% |
| content | 80% | 93% | 93% | 100% |

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

### Real-world files (no ground truth; EPUBCheck only) (8 files)

| | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|
| strict | 13% | 75% | 75% | 100% |
| kindle | 13% | 100% | 75% | 100% |

### Fixed rate by defect category (all broken files, single-defect copies only)

| category | n | original | calibre | calibre-v3 | magpie |
|---|---|---|---|---|---|
| container_missing | 2 | 0% | 0% | 0% | 100% |
| container_wrong_path | 4 | 0% | 0% | 0% | 100% |
| cover_undeclared | 2 | 0% | 0% | 0% | 100% |
| cover_wrong_id | 6 | 0% | 17% | 17% | 100% |
| duplicate_ids | 1 | 0% | 100% | 100% | 100% |
| font_corrupt | 1 | 100% | 0% | 0% | 100% |
| href_spaces | 2 | 0% | 0% | 0% | 100% |
| manifest_missing_file | 2 | 0% | 50% | 50% | 100% |
| manifest_unlisted_file | 1 | 0% | 100% | 100% | 100% |
| media_type_wrong | 1 | 0% | 0% | 0% | 100% |
| meta_filename_title | 2 | 0% | 0% | 0% | 100% |
| meta_no_author | 1 | 0% | 0% | 0% | 100% |
| meta_no_modified | 1 | 0% | 0% | 0% | 100% |
| meta_no_title | 3 | 0% | 0% | 0% | 100% |
| meta_uid_mismatch | 4 | 0% | 25% | 25% | 100% |
| meta_unknown_author | 3 | 0% | 0% | 0% | 100% |
| mimetype_compressed | 4 | 75% | 50% | 50% | 100% |
| mimetype_missing | 2 | 0% | 0% | 0% | 100% |
| mimetype_not_first | 2 | 0% | 50% | 50% | 100% |
| mimetype_trailing_newline | 1 | 0% | 100% | 100% | 100% |
| spine_bad_idref | 2 | 0% | 0% | 0% | 100% |
| toc_ncx_broken | 3 | 0% | 0% | 0% | 100% |
| xhtml_html_entities | 5 | 0% | 60% | 60% | 100% |
| xhtml_tag_soup | 3 | 0% | 33% | 33% | 100% |
| xhtml_unclosed_tags | 2 | 0% | 0% | 0% | 100% |

### Magpie runtime

Median 12 ms per book. 0 crash(es).

### Magpie misses (0)

