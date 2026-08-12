//go:build !windows
// +build !windows

package main

import (
	"os/exec"
	"syscall"
)

// isolateProcessGroup puts the backend into its own process group.
//
// Without this the backend — and everything it spawns — shares the wrapper's
// group. Coding agents readily spawn a nested codeagent-wrapper (e.g. when a
// prompt asks for a cross-model check), so several logical sessions end up in
// one group. Any group-scoped cleanup from any layer then delivers
// SIGINT/SIGTERM to unrelated, still-running wrapper instances, which trip the
// signal.NotifyContext path and die with exit 130 "execution cancelled" —
// typically near end-of-run, after the backend already finished its file work
// (issue #151).
//
// Giving the child its own group cuts both directions: outside group signals no
// longer reach into this session, and our own cleanup no longer leaks past it.
func isolateProcessGroup(cmd *exec.Cmd) {
	if cmd == nil {
		return
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	// Pgid 0 with Setpgid makes the child a group leader, so its pgid == its pid.
	cmd.SysProcAttr.Setpgid = true
	cmd.SysProcAttr.Pgid = 0
}

// killProcessGroup signals the whole group led by pid. This is the Unix
// counterpart of the Windows `taskkill /T` path — it reaps the backend's own
// shell children instead of leaving them behind.
//
// Only meaningful for a process started via isolateProcessGroup, where pgid ==
// pid. Returns an error when no such group exists so callers can fall back to
// signalling the single process.
func killProcessGroup(pid int, sig syscall.Signal) error {
	if pid <= 0 {
		return syscall.ESRCH
	}
	return syscall.Kill(-pid, sig)
}
