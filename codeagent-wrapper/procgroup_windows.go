//go:build windows
// +build windows

package main

import (
	"errors"
	"os/exec"
	"syscall"
)

// isolateProcessGroup is a no-op on Windows: process groups work differently and
// tree teardown already goes through killProcessTree (`taskkill /T`).
func isolateProcessGroup(cmd *exec.Cmd) {}

// killProcessGroup always fails on Windows so callers fall back to
// killProcessTree, which is the correct tree-scoped teardown there.
func killProcessGroup(pid int, sig syscall.Signal) error {
	return errors.New("process groups are not supported on windows")
}
