package tree_sitter_bluespec_test

import (
	"testing"

	tree_sitter "github.com/smacker/go-tree-sitter"
	"github.com/tree-sitter/tree-sitter-bluespec"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_bluespec.Language())
	if language == nil {
		t.Errorf("Error loading Bluespec grammar")
	}
}
