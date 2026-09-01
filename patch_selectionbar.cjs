const fs = require('fs');
let code = fs.readFileSync('src/components/SelectionBar.tsx', 'utf-8');

code = code.replace(
  '      await setTagsForSelection(tagId, apply);',
  `      const nextTags = new Set(appliedTagIds);
      if (apply) nextTags.add(tagId);
      else nextTags.delete(tagId);
      await setTagsForSelection(Array.from(nextTags));`
);

fs.writeFileSync('src/components/SelectionBar.tsx', code);
