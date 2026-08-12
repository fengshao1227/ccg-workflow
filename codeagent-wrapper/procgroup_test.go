//go:build !windows
// +build !windows

package main

import (
	"os/exec"
	"syscall"
	"testing"
)

// Regression for issue #151: without its own process group, a group-scoped
// signal aimed at one wrapper session reaches unrelated nested sessions.
func TestIsolateProcessGroup_SetsSetpgid(t *testing.T) {
	cmd := exec.Command("true")
	isolateProcessGroup(cmd)

	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr must be populated")
	}
	if !cmd.SysProcAttr.Setpgid {
		t.Fatal("Setpgid must be true so the child leads its own group")
	}
	if cmd.SysProcAttr.Pgid != 0 {
		t.Fatalf("Pgid = %d, want 0 (child becomes group leader)", cmd.SysProcAttr.Pgid)
	}
}

func TestIsolateProcessGroup_PreservesExistingAttrs(t *testing.T) {
	cmd := exec.Command("true")
	cmd.SysProcAttr = &syscall.SysProcAttr{Foreground: false}
	isolateProcessGroup(cmd)
	if !cmd.SysProcAttr.Setpgid {
		t.Fatal("Setpgid must be set on the existing SysProcAttr")
	}
}

func TestIsolateProcessGroup_NilSafe(t *testing.T) {
	isolateProcessGroup(nil) // must not panic
}

func TestKillProcessGroup_ActuallyIsolates(t *testing.T) {
	cmd := exec.Command("sleep", "30")
	isolateProcessGroup(cmd)
	if err := cmd.Start(); err != nil {
		t.Skipf("cannot start helper: %v", err)
	}
	pid := cmd.Process.Pid

	// With Setpgid the child leads a group whose id equals its pid.
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		t.Fatalf("Getpgid: %v", err)
	}
	if pgid != pid {
		t.Fatalf("pgid = %d, want %d (child must lead its own group)", pgid, pid)
	}
	// And it must differ from ours, or external group signals would still reach it.
	if ourPgid, err := syscall.Getpgid(0); err == nil && pgid == ourPgid {
		t.Fatalf("child shares the wrapper's group %d — issue #151 not fixed", pgid)
	}

	if err := killProcessGroup(pid, syscall.SIGKILL); err != nil {
		t.Fatalf("killProcessGroup: %v", err)
	}
	_ = cmd.Wait()
}

func TestKillProcessGroup_RejectsInvalidPid(t *testing.T) {
	if err := killProcessGroup(0, syscall.SIGTERM); err == nil {
		t.Fatal("pid 0 would signal our own group — must be rejected")
	}
}
