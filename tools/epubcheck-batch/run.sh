#!/bin/sh
# Usage: ls *.epub | tools/epubcheck-batch/run.sh > results.jsonl
D=$(dirname "$0")
J=${EPUBCHECK_JAR:-$(python3 -c "import epubcheck,os;print(os.path.join(os.path.dirname(epubcheck.__file__),'epubcheck.jar'))")}
[ -f "$D/BatchCheck.class" ] || javac -cp "$J" -d "$D" "$D/BatchCheck.java"
exec java -cp "$J:$D" BatchCheck 2>/dev/null
